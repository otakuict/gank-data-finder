package gank

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"sync"
	"time"
)

const (
	apiBase  = "https://api.ganknow.com/v1"
	cacheTTL = 3 * time.Minute
)

type APIError struct {
	Message string
	Status  int
}

func (e *APIError) Error() string { return e.Message }

type cacheEntry struct {
	expires time.Time
	data    []byte
}

type Client struct {
	httpClient *http.Client
	mu         sync.RWMutex
	cache      map[string]cacheEntry
}

func NewClient() *Client {
	return &Client{
		httpClient: &http.Client{Timeout: 12 * time.Second},
		cache:      make(map[string]cacheEntry),
	}
}

func (c *Client) getJSON(ctx context.Context, endpoint string, target any) error {
	c.mu.RLock()
	cached, ok := c.cache[endpoint]
	c.mu.RUnlock()
	if ok && time.Now().Before(cached.expires) {
		return json.Unmarshal(cached.data, target)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "gank-post-finder/2.0")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return &APIError{Message: "Gank API request timed out.", Status: http.StatusGatewayTimeout}
		}
		return &APIError{Message: "Could not reach the Gank API.", Status: http.StatusBadGateway}
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return &APIError{Message: "Seller was not found on Gank.", Status: http.StatusNotFound}
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return &APIError{Message: fmt.Sprintf("Gank API returned %d.", resp.StatusCode), Status: http.StatusBadGateway}
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
	if err != nil {
		return &APIError{Message: "Could not read the Gank API response.", Status: http.StatusBadGateway}
	}
	c.mu.Lock()
	c.cache[endpoint] = cacheEntry{expires: time.Now().Add(cacheTTL), data: body}
	c.mu.Unlock()
	if err := json.Unmarshal(body, target); err != nil {
		return &APIError{Message: "Gank returned an unexpected response.", Status: http.StatusBadGateway}
	}
	return nil
}

func object(value any) map[string]any {
	if result, ok := value.(map[string]any); ok {
		return result
	}
	return map[string]any{}
}

func identifier(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case json.Number:
		return typed.String()
	default:
		return ""
	}
}

func firstID(objects ...map[string]any) string {
	for _, item := range objects {
		for _, key := range []string{"id", "uuid", "userId"} {
			if value := identifier(item[key]); value != "" {
				return value
			}
		}
	}
	return ""
}

func (c *Client) ResolveUserID(ctx context.Context, seller string) (string, error) {
	var payload map[string]any
	endpoint := apiBase + "/users/nickname/" + url.PathEscape(seller) + "?timezone=7"
	if err := c.getJSON(ctx, endpoint, &payload); err != nil {
		return "", err
	}
	data := object(payload["data"])
	user := object(data["user"])
	if len(user) == 0 {
		user = object(payload["user"])
	}
	id := firstID(data, user, payload)
	if id == "" {
		return "", &APIError{Message: "Gank returned an unexpected seller profile.", Status: http.StatusBadGateway}
	}
	return id, nil
}

func findArray(value any) []any {
	if array, ok := value.([]any); ok {
		return array
	}
	root := object(value)
	for _, key := range []string{"data", "items", "results", "posts", "services"} {
		if array, ok := root[key].([]any); ok {
			return array
		}
		nested := object(root[key])
		for _, nestedKey := range []string{"data", "items", "results", "posts", "services"} {
			if array, ok := nested[nestedKey].([]any); ok {
				return array
			}
		}
	}
	return nil
}

func (c *Client) fetchAll(ctx context.Context, endpoint func(int) string, pageSize int) ([]map[string]any, error) {
	all := make([]map[string]any, 0)
	for page := 1; page <= 100; page++ {
		var payload any
		if err := c.getJSON(ctx, endpoint(page), &payload); err != nil {
			return nil, err
		}
		batch := findArray(payload)
		for _, item := range batch {
			all = append(all, object(item))
		}
		if len(batch) < pageSize {
			break
		}
	}
	return all, nil
}

func (c *Client) FetchPosts(ctx context.Context, userID string) ([]map[string]any, error) {
	return c.fetchAll(ctx, func(page int) string {
		return fmt.Sprintf("%s/posts?author=%s&page=%d&perPage=200", apiBase, url.QueryEscape(userID), page)
	}, 200)
}

func (c *Client) FetchServices(ctx context.Context, userID string) ([]map[string]any, error) {
	return c.fetchAll(ctx, func(page int) string {
		return fmt.Sprintf("%s/catalogs/services?userId=%s&page=%d&per_page=100&order_by=createdAt%%20desc", apiBase, url.QueryEscape(userID), page)
	}, 100)
}
