package gank

import (
	"context"
	"errors"
	"strconv"
	"testing"
	"time"
)

func TestFetchPagesStopsAfterCancellationWithCachedPages(t *testing.T) {
	client := NewClient()
	client.cache["page-1"] = cacheEntry{
		expires: time.Now().Add(time.Minute),
		data:    []byte(`{"data":[{"id":"first"}]}`),
	}
	client.cache["page-2"] = cacheEntry{
		expires: time.Now().Add(time.Minute),
		data:    []byte(`{"data":[{"id":"second"}]}`),
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	pages := 0
	err := client.fetchPages(ctx, func(page int) string {
		return "page-" + strconv.Itoa(page)
	}, 1, func(records []map[string]any) error {
		pages++
		cancel()
		return nil
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context cancellation, got %v", err)
	}
	if pages != 1 {
		t.Fatalf("expected one page before cancellation, got %d", pages)
	}
}
