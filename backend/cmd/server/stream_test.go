package main

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

type stagedStreamer struct{ continueSearch <-chan struct{} }

type cancelAwareStreamer struct{ stopped chan struct{} }

func (s cancelAwareStreamer) ResolveUserID(context.Context, string) (string, error) {
	return "seller-id", nil
}

func (s cancelAwareStreamer) StreamPosts(ctx context.Context, _ string, onPage func([]map[string]any) error) error {
	if err := onPage([]map[string]any{{"uuid": "first", "title": "260827 CHAEWON first"}}); err != nil {
		return err
	}
	<-ctx.Done()
	close(s.stopped)
	return ctx.Err()
}

func (s cancelAwareStreamer) StreamServices(context.Context, string, func([]map[string]any) error) error {
	return nil
}

func (s stagedStreamer) ResolveUserID(context.Context, string) (string, error) {
	return "seller-id", nil
}

func (s stagedStreamer) StreamPosts(ctx context.Context, _ string, onPage func([]map[string]any) error) error {
	if err := onPage([]map[string]any{{"uuid": "first", "title": "260827 CHAEWON first"}}); err != nil {
		return err
	}
	select {
	case <-s.continueSearch:
	case <-ctx.Done():
		return ctx.Err()
	}
	return onPage([]map[string]any{{"uuid": "second", "title": "260827 CHAEWON second"}})
}

func (s stagedStreamer) StreamServices(context.Context, string, func([]map[string]any) error) error {
	return nil
}

func TestStreamSearchEmitsResultsBeforeSearchCompletes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	release := make(chan struct{})
	defer func() {
		select {
		case <-release:
		default:
			close(release)
		}
	}()
	router := gin.New()
	registerStreamSearch(router, stagedStreamer{continueSearch: release})
	server := httptest.NewServer(router)
	defer server.Close()

	client := &http.Client{Timeout: 3 * time.Second}
	response, err := client.Get(server.URL + "/api/search/stream?seller=test&source=posts&mode=exact&date=260827&name=chaewon")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status: %d", response.StatusCode)
	}

	events := make(chan map[string]any, 3)
	go func() {
		scanner := bufio.NewScanner(response.Body)
		for scanner.Scan() {
			var event map[string]any
			if json.Unmarshal(scanner.Bytes(), &event) == nil {
				events <- event
			}
		}
	}()
	select {
	case event := <-events:
		if event["type"] != "result" || event["result"].(map[string]any)["id"] != "first" {
			t.Fatalf("unexpected first event: %#v", event)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("first result was not streamed while the search was still running")
	}
	close(release)
	for _, want := range []string{"result", "done"} {
		select {
		case event := <-events:
			if event["type"] != want {
				t.Fatalf("expected %s event, got %#v", want, event)
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("timed out waiting for %s event", want)
		}
	}
}

func TestStreamSearchCancelsWorkWhenClientStops(t *testing.T) {
	gin.SetMode(gin.TestMode)
	streamer := cancelAwareStreamer{stopped: make(chan struct{})}
	router := gin.New()
	registerStreamSearch(router, streamer)
	server := httptest.NewServer(router)
	defer server.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, server.URL+"/api/search/stream?seller=test&source=posts&mode=exact&date=260827&name=chaewon", nil)
	if err != nil {
		t.Fatal(err)
	}
	response, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if !bufio.NewScanner(response.Body).Scan() {
		t.Fatal("expected a streamed result before stopping")
	}
	cancel()
	response.Body.Close()
	select {
	case <-streamer.stopped:
	case <-time.After(2 * time.Second):
		t.Fatal("server kept searching after the client stopped")
	}
}
