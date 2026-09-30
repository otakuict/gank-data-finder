package search

import (
	"encoding/json"
	"fmt"
	"html"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

	"gank-post-finder/backend/internal/types"
	"golang.org/x/text/unicode/norm"
)

var (
	separatorsPattern = regexp.MustCompile(`[_-]+`)
	spacesPattern     = regexp.MustCompile(`\s+`)
	datePattern       = regexp.MustCompile(`[0-9]{6}`)
	countPattern      = regexp.MustCompile(`(?i)([0-9]{1,6})\s*(\+)?\s*(pics?|pictures?|photos?|images?|files?|p)\b`)
	tagPattern        = regexp.MustCompile(`<[^>]*>`)
	previewPattern    = regexp.MustCompile(`(?i)https?://(?:www\.)?ganknow\.com/post/[^\s<>"']+`)
	externalPattern   = regexp.MustCompile(`(?i)https?://(?:[^\s<>"']+\.)?(?:gumroad\.com|ko-fi\.com)/[^\s<>"']+`)
)

func Normalize(value any) string {
	text := norm.NFKC.String(fmt.Sprint(value))
	text = strings.ToLower(text)
	text = separatorsPattern.ReplaceAllString(text, " ")
	return strings.TrimSpace(spacesPattern.ReplaceAllString(text, " "))
}

func ExtractDates(text string) []string {
	seen := map[string]bool{}
	results := []string{}
	for _, indices := range datePattern.FindAllStringIndex(text, -1) {
		if indices[0] > 0 && unicode.IsDigit(rune(text[indices[0]-1])) {
			continue
		}
		if indices[1] < len(text) && unicode.IsDigit(rune(text[indices[1]])) {
			continue
		}
		value := text[indices[0]:indices[1]]
		if !seen[value] {
			seen[value] = true
			results = append(results, value)
		}
	}
	return results
}

func ExtractCounts(text string) []types.ExtractedCount {
	results := []types.ExtractedCount{}
	for _, match := range countPattern.FindAllStringSubmatchIndex(text, -1) {
		if match[0] > 0 && text[match[0]-1] >= '0' && text[match[0]-1] <= '9' {
			continue
		}
		value, err := strconv.Atoi(text[match[2]:match[3]])
		if err != nil || value < 1 {
			continue
		}
		approximate := match[4] >= 0
		results = append(results, types.ExtractedCount{Value: value, Approximate: approximate, Raw: text[match[0]:match[1]]})
	}
	return results
}

func stringValue(raw map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := raw[key].(string); ok {
			return value
		}
	}
	return ""
}

func boolValue(raw map[string]any, keys ...string) (bool, bool) {
	for _, key := range keys {
		if value, ok := raw[key].(bool); ok {
			return value, true
		}
	}
	return false, false
}

func recordID(raw map[string]any) string {
	if value := stringValue(raw, "uuid", "id", "_id", "slug"); value != "" {
		return value
	}
	for _, key := range []string{"id", "uuid"} {
		if value, ok := raw[key].(float64); ok {
			return strconv.FormatFloat(value, 'f', -1, 64)
		}
	}
	encoded, _ := json.Marshal(raw)
	if len(encoded) > 100 {
		encoded = encoded[:100]
	}
	return string(encoded)
}

func status(raw map[string]any, source string) string {
	if source == "Post" {
		return "active"
	}
	if sold, ok := boolValue(raw, "isSoldOut", "soldOut"); ok && sold {
		return "sold-out"
	}
	if stock, ok := raw["stock"].(float64); ok && stock <= 0 {
		return "sold-out"
	}
	if active, ok := boolValue(raw, "isActive", "active", "is_active"); ok {
		if active {
			return "active"
		}
		return "inactive"
	}
	return "unknown"
}

func cleanURL(value string) string { return strings.TrimRight(value, "),.;") }

func firstURL(text string, pattern *regexp.Regexp) *string {
	value := pattern.FindString(text)
	if value == "" {
		return nil
	}
	value = cleanURL(value)
	return &value
}

func suppliedURL(raw map[string]any, keys ...string) *string {
	value := stringValue(raw, keys...)
	if strings.HasPrefix(strings.ToLower(value), "http://") || strings.HasPrefix(strings.ToLower(value), "https://") {
		return &value
	}
	return nil
}

func excerpt(text string) string {
	text = html.UnescapeString(tagPattern.ReplaceAllString(text, " "))
	text = strings.TrimSpace(spacesPattern.ReplaceAllString(text, " "))
	runes := []rune(text)
	if len(runes) > 280 {
		runes = runes[:280]
	}
	return string(runes)
}

func contains(values []string, query string) bool {
	for _, value := range values {
		if value == query {
			return true
		}
	}
	return false
}

func matchAndRank(text string, params types.SearchParams, counts []types.ExtractedCount) (int, string, bool) {
	normalized := Normalize(text)
	dateMatch := params.Date == "" || contains(ExtractDates(text), params.Date)
	namePhrase := Normalize(params.Name)
	nameMatch := namePhrase == "" || strings.Contains(normalized, namePhrase)
	broadName := true
	for _, token := range strings.Fields(namePhrase) {
		if !strings.Contains(normalized, token) {
			broadName = false
			break
		}
	}
	broadDate := params.Date == "" || strings.Contains(normalized, params.Date)
	if params.Mode == types.ModeExact && (!dateMatch || !nameMatch) {
		return 0, "", false
	}
	if params.Mode == types.ModeBroad && (!broadDate || !broadName) {
		return 0, "", false
	}

	exactCount, approximateCount := false, false
	if params.Count != nil {
		for _, count := range counts {
			if count.Value == *params.Count && count.Approximate {
				approximateCount = true
			}
			if count.Value == *params.Count && !count.Approximate {
				exactCount = true
			}
		}
	}
	if dateMatch && nameMatch && exactCount {
		return 1, "exact date, name, and count", true
	}
	if dateMatch && nameMatch && approximateCount {
		return 2, "exact date and name; approximate count", true
	}
	if dateMatch && nameMatch {
		if params.Count != nil {
			return 3, "exact date and name; count differs", true
		}
		return 3, "exact date and name", true
	}
	return 4, "broad partial match", true
}

func toResult(raw map[string]any, source string, params types.SearchParams, knownPosts map[string]bool) *types.SearchResult {
	title, body := stringValue(raw, "title", "name"), stringValue(raw, "content", "description", "body", "caption")
	if source == "Shop" {
		title, body = stringValue(raw, "name", "title"), stringValue(raw, "description", "content", "detail")
	}
	text := title + " " + body
	counts := ExtractCounts(text)
	rank, explanation, matched := matchAndRank(text, params, counts)
	if !matched {
		return nil
	}
	resultStatus := status(raw, source)
	if source == "Shop" && !params.IncludeInactive && resultStatus != "active" && resultStatus != "unknown" {
		return nil
	}

	id := recordID(raw)
	previewURL := firstURL(body, previewPattern)
	externalURL := firstURL(text, externalPattern)
	direct := suppliedURL(raw, "url", "link", "shareUrl", "webUrl", "permalink")
	var postURL, shopURL *string
	if source == "Post" {
		postURL = direct
		if postURL == nil {
			value := "https://ganknow.com/post/" + id
			postURL = &value
		}
	} else {
		postURL = previewURL
		shopURL = direct
		if shopURL == nil {
			value := "https://ganknow.com/" + params.Seller + "/services/" + id
			shopURL = &value
		}
	}
	previewUnavailable := false
	if previewURL != nil {
		parts := strings.Split(strings.TrimRight(*previewURL, "/"), "/")
		previewID := Normalize(parts[len(parts)-1])
		previewUnavailable = !knownPosts[previewID]
	}
	var createdAt *string
	if value := stringValue(raw, "createdAt", "created_at", "publishedAt", "published_at"); value != "" {
		createdAt = &value
	}
	var fileCount *types.ExtractedCount
	if len(counts) > 0 {
		copy := counts[0]
		fileCount = &copy
	}
	if title == "" {
		title = "(untitled)"
	}
	return &types.SearchResult{ID: id, Seller: params.Seller, Source: source, Title: title, CreatedAt: createdAt, FileCount: fileCount, Status: resultStatus, Excerpt: excerpt(body), PostURL: postURL, ShopURL: shopURL, ExternalURL: externalURL, PreviewURL: previewURL, PreviewUnavailable: previewUnavailable, MatchExplanation: explanation, Rank: rank}
}

func SearchRecords(posts, services []map[string]any, params types.SearchParams) []types.SearchResult {
	knownPosts := map[string]bool{}
	for _, post := range posts {
		knownPosts[Normalize(recordID(post))] = true
	}
	candidates := make([]types.SearchResult, 0)
	for _, post := range posts {
		if result := toResult(post, "Post", params, knownPosts); result != nil {
			candidates = append(candidates, *result)
		}
	}
	for _, service := range services {
		if result := toResult(service, "Shop", params, knownPosts); result != nil {
			candidates = append(candidates, *result)
		}
	}
	results := Deduplicate(candidates)
	sort.SliceStable(results, func(i, j int) bool {
		if results[i].Rank != results[j].Rank {
			return results[i].Rank < results[j].Rank
		}
		left, _ := time.Parse(time.RFC3339, dereference(results[i].CreatedAt))
		right, _ := time.Parse(time.RFC3339, dereference(results[j].CreatedAt))
		return left.After(right)
	})
	return results
}

func dereference(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func Deduplicate(results []types.SearchResult) []types.SearchResult {
	seen := map[string]bool{}
	unique := make([]types.SearchResult, 0, len(results))
	for _, result := range results {
		keys := []string{result.ID, dereference(result.PostURL), dereference(result.ShopURL)}
		duplicate := false
		for _, key := range keys {
			if key != "" && seen[Normalize(key)] {
				duplicate = true
				break
			}
		}
		if duplicate {
			continue
		}
		for _, key := range keys {
			if key != "" {
				seen[Normalize(key)] = true
			}
		}
		unique = append(unique, result)
	}
	return unique
}
