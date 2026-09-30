package search

import (
	"testing"

	"gank-post-finder/backend/internal/types"
)

func intPointer(value int) *int { return &value }

func baseParams() types.SearchParams {
	return types.SearchParams{Seller: "loveshakedata", Date: "260827", Name: "chaewon", Count: intPointer(2075), Source: types.SourceBoth, IncludeInactive: true, Mode: types.ModeExact}
}

func TestExtractCounts(t *testing.T) {
	counts := ExtractCounts("1904 PICS, 2000 files, 2400+ FILES and 4099p")
	if len(counts) != 4 {
		t.Fatalf("expected 4 counts, got %d", len(counts))
	}
	expected := []struct {
		value       int
		approximate bool
	}{{1904, false}, {2000, false}, {2400, true}, {4099, false}}
	for index, item := range expected {
		if counts[index].Value != item.value || counts[index].Approximate != item.approximate {
			t.Fatalf("unexpected count at %d: %+v", index, counts[index])
		}
	}
}

func TestNormalize(t *testing.T) {
	if value := Normalize("  CHAEWON_data\nSet  "); value != "chaewon data set" {
		t.Fatalf("unexpected normalization: %q", value)
	}
}

func TestInactiveFiltering(t *testing.T) {
	service := map[string]any{"uuid": "s1", "name": "260827 CHAEWON 2075 files", "description": "PREVIEW", "isActive": false}
	params := baseParams()
	params.IncludeInactive = false
	if results := SearchRecords(nil, []map[string]any{service}, params); len(results) != 0 {
		t.Fatalf("expected inactive result to be filtered")
	}
	params.IncludeInactive = true
	if results := SearchRecords(nil, []map[string]any{service}, params); len(results) != 1 {
		t.Fatalf("expected inactive result to be included")
	}
}

func TestRanking(t *testing.T) {
	posts := []map[string]any{
		{"uuid": "3", "title": "260827 chaewon 1904 pics"},
		{"uuid": "2", "title": "260827 chaewon 2075+ files"},
		{"uuid": "1", "title": "260827 chaewon 2075 files"},
	}
	results := SearchRecords(posts, nil, baseParams())
	if len(results) != 3 || results[0].ID != "1" || results[0].Rank != 1 || results[1].Rank != 2 || results[2].Rank != 3 {
		t.Fatalf("unexpected ranking: %+v", results)
	}
}

func TestDeduplicate(t *testing.T) {
	url := "https://example.test/post"
	results := []types.SearchResult{{ID: "same", PostURL: &url}, {ID: "other", PostURL: &url}}
	if unique := Deduplicate(results); len(unique) != 1 {
		t.Fatalf("expected one deduplicated result, got %d", len(unique))
	}
}
