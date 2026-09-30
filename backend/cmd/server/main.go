package main

import (
	"errors"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"

	"gank-post-finder/backend/internal/gank"
	"gank-post-finder/backend/internal/search"
	"gank-post-finder/backend/internal/types"
	"github.com/gin-gonic/gin"
)

var sellerPattern = regexp.MustCompile(`^[\p{L}\p{N}_.-]{1,80}$`)

func cors() gin.HandlerFunc {
	allowed := map[string]bool{"http://localhost:5173": true, "http://127.0.0.1:5173": true}
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if allowed[origin] {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Vary", "Origin")
		}
		c.Header("Access-Control-Allow-Methods", "GET, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type")
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

func respondError(c *gin.Context, err error) {
	var apiError *gank.APIError
	if errors.As(err, &apiError) {
		c.JSON(apiError.Status, gin.H{"error": apiError.Message})
		return
	}
	c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
}

func validateQuery(c *gin.Context) (types.SearchParams, bool) {
	params := types.SearchParams{Seller: strings.TrimSpace(c.Query("seller")), Date: strings.TrimSpace(c.Query("date")), Name: strings.TrimSpace(c.Query("name")), Source: types.SearchSource(c.DefaultQuery("source", "both")), Mode: types.MatchMode(c.DefaultQuery("mode", "exact")), IncludeInactive: strings.EqualFold(c.Query("includeInactive"), "true")}
	countText := strings.TrimSpace(c.Query("count"))
	if !sellerPattern.MatchString(params.Seller) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Seller nickname is required and may contain letters, numbers, dots, dashes, or underscores."})
		return params, false
	}
	if params.Date != "" {
		if len(params.Date) != 6 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Date must contain exactly six digits (YYMMDD)."})
			return params, false
		}
		if _, err := strconv.Atoi(params.Date); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Date must contain exactly six digits (YYMMDD)."})
			return params, false
		}
	}
	if len([]rune(params.Name)) > 100 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Idol/name must be 100 characters or fewer."})
		return params, false
	}
	if countText != "" {
		value, err := strconv.Atoi(countText)
		if err != nil || value < 1 || len(countText) > 7 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "File count must be a positive whole number."})
			return params, false
		}
		params.Count = &value
	}
	if params.Source != types.SourcePosts && params.Source != types.SourceShop && params.Source != types.SourceBoth {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Source must be posts, shop, or both."})
		return params, false
	}
	if params.Mode != types.ModeExact && params.Mode != types.ModeBroad {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Mode must be exact or broad."})
		return params, false
	}
	if params.Date == "" && params.Name == "" && params.Count == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Enter at least a date, idol/name, or file count."})
		return params, false
	}
	return params, true
}

func main() {
	gin.SetMode(gin.ReleaseMode)
	client := gank.NewClient()
	router := gin.New()
	if err := router.SetTrustedProxies(nil); err != nil {
		panic(err)
	}
	router.Use(gin.Logger(), gin.Recovery(), cors())
	router.GET("/api/health", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })
	router.GET("/api/sellers/resolve", func(c *gin.Context) {
		seller := strings.TrimSpace(c.Query("seller"))
		if !sellerPattern.MatchString(seller) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Enter a valid seller nickname."})
			return
		}
		userID, err := client.ResolveUserID(c.Request.Context(), seller)
		if err != nil {
			respondError(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"seller": seller, "userId": userID})
	})
	router.GET("/api/search", func(c *gin.Context) {
		params, valid := validateQuery(c)
		if !valid {
			return
		}
		userID, err := client.ResolveUserID(c.Request.Context(), params.Seller)
		if err != nil {
			respondError(c, err)
			return
		}
		var posts, services []map[string]any
		var postsErr, servicesErr error
		var wait sync.WaitGroup
		if params.Source != types.SourceShop {
			wait.Add(1)
			go func() { defer wait.Done(); posts, postsErr = client.FetchPosts(c.Request.Context(), userID) }()
		}
		if params.Source != types.SourcePosts {
			wait.Add(1)
			go func() { defer wait.Done(); services, servicesErr = client.FetchServices(c.Request.Context(), userID) }()
		}
		wait.Wait()
		if postsErr != nil {
			respondError(c, postsErr)
			return
		}
		if servicesErr != nil {
			respondError(c, servicesErr)
			return
		}
		results := search.SearchRecords(posts, services, params)
		c.JSON(http.StatusOK, gin.H{"seller": params.Seller, "userId": userID, "resultCount": len(results), "fetched": gin.H{"posts": len(posts), "shop": len(services)}, "results": results})
	})
	port := os.Getenv("PORT")
	if port == "" {
		port = "3001"
	}
	if err := router.Run("0.0.0.0:" + port); err != nil {
		panic(err)
	}
}
