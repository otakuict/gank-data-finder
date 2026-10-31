package main

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"

	"gank-post-finder/backend/internal/search"
	"gank-post-finder/backend/internal/types"
	"github.com/gin-gonic/gin"
)

type searchPage struct {
	source  string
	records []map[string]any
	err     error
}

type searchStreamer interface {
	ResolveUserID(context.Context, string) (string, error)
	StreamPosts(context.Context, string, func([]map[string]any) error) error
	StreamServices(context.Context, string, func([]map[string]any) error) error
}

func registerStreamSearch(router *gin.Engine, client searchStreamer) {
	router.GET("/api/search/stream", func(c *gin.Context) {
		params, valid := validateQuery(c)
		if !valid {
			return
		}
		ctx, cancel := context.WithCancel(c.Request.Context())
		defer cancel()
		userID, err := client.ResolveUserID(ctx, params.Seller)
		if err != nil {
			respondError(c, err)
			return
		}

		c.Header("Content-Type", "application/x-ndjson; charset=utf-8")
		c.Header("Cache-Control", "no-cache, no-transform")
		c.Header("X-Accel-Buffering", "no")
		c.Status(http.StatusOK)
		c.Writer.Flush()

		emit := func(value gin.H) error {
			if err := ctx.Err(); err != nil {
				return err
			}
			encoded, err := json.Marshal(value)
			if err != nil {
				return err
			}
			if _, err := c.Writer.Write(append(encoded, '\n')); err != nil {
				return err
			}
			c.Writer.Flush()
			return nil
		}

		pages := make(chan searchPage, 2)
		var wait sync.WaitGroup
		start := func(source string, fetch func(context.Context, string, func([]map[string]any) error) error) {
			wait.Add(1)
			go func() {
				defer wait.Done()
				err := fetch(ctx, userID, func(records []map[string]any) error {
					if err := ctx.Err(); err != nil {
						return err
					}
					select {
					case pages <- searchPage{source: source, records: records}:
						return nil
					case <-ctx.Done():
						return ctx.Err()
					}
				})
				if err != nil && ctx.Err() == nil {
					select {
					case pages <- searchPage{source: source, err: err}:
					case <-ctx.Done():
					}
				}
			}()
		}
		if params.Source != types.SourceShop {
			start("Post", client.StreamPosts)
		}
		if params.Source != types.SourcePosts {
			start("Shop", client.StreamServices)
		}
		go func() { wait.Wait(); close(pages) }()

		knownPosts := map[string]bool{}
		seen := map[string]bool{}
		pendingShops := []types.SearchResult{}
		fetchedPosts, fetchedShops := 0, 0
		var searchError error
		var postsFailed bool
		for page := range pages {
			if ctx.Err() != nil {
				return
			}
			if page.err != nil {
				if searchError == nil {
					searchError = page.err
				}
				if page.source == "Post" {
					postsFailed = true
				}
				continue
			}
			if page.source == "Post" {
				fetchedPosts += len(page.records)
				for _, record := range page.records {
					knownPosts[search.Normalize(search.RecordID(record))] = true
				}
			} else {
				fetchedShops += len(page.records)
			}
			for _, record := range page.records {
				if ctx.Err() != nil {
					return
				}
				result := search.MatchRecord(record, page.source, params, knownPosts)
				if result == nil {
					continue
				}
				keys := []string{result.ID}
				if result.PostURL != nil {
					keys = append(keys, *result.PostURL)
				}
				if result.ShopURL != nil {
					keys = append(keys, *result.ShopURL)
				}
				duplicate := false
				for _, key := range keys {
					if key != "" && seen[search.Normalize(key)] {
						duplicate = true
						break
					}
				}
				if duplicate {
					continue
				}
				for _, key := range keys {
					if key != "" {
						seen[search.Normalize(key)] = true
					}
				}
				if page.source == "Shop" && result.PreviewURL != nil {
					result.PreviewUnavailable = false
					pendingShops = append(pendingShops, *result)
				}
				if err := emit(gin.H{"type": "result", "result": result}); err != nil {
					return
				}
			}
		}

		if !postsFailed {
			for _, result := range pendingShops {
				parts := strings.Split(strings.TrimRight(*result.PreviewURL, "/"), "/")
				if !knownPosts[search.Normalize(parts[len(parts)-1])] {
					result.PreviewUnavailable = true
					if err := emit(gin.H{"type": "result", "result": result}); err != nil {
						return
					}
				}
			}
		}
		if searchError != nil {
			_ = emit(gin.H{"type": "error", "error": searchError.Error()})
			return
		}
		_ = emit(gin.H{"type": "done", "fetched": gin.H{"posts": fetchedPosts, "shop": fetchedShops}})
	})
}
