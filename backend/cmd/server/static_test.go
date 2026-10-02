package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestServeFrontend(t *testing.T) {
	gin.SetMode(gin.TestMode)
	directory := t.TempDir()
	if err := os.Mkdir(filepath.Join(directory, "assets"), 0755); err != nil {
		t.Fatal(err)
	}
	for name, contents := range map[string]string{"index.html": "<html>app</html>", "assets/app.js": "console.log('app')"} {
		if err := os.WriteFile(filepath.Join(directory, name), []byte(contents), 0644); err != nil {
			t.Fatal(err)
		}
	}
	router := gin.New()
	if err := serveFrontend(router, directory); err != nil {
		t.Fatal(err)
	}
	router.GET("/api/health", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })
	for _, test := range []struct {
		method, url string
		status      int
		body        string
	}{
		{"GET", "/", 200, "<html>app</html>"},
		{"HEAD", "/", 200, ""},
		{"GET", "/assets/app.js", 200, "console.log('app')"},
		{"GET", "/assets/missing.js", 404, ""},
		{"GET", "/assets/", 404, ""},
		{"GET", "/api/health", 200, `{"ok":true}`},
		{"GET", "/api/missing", 404, ""},
		{"GET", "/api", 404, ""},
		{"GET", "/missing", 404, ""},
		{"POST", "/", 404, ""},
		{"GET", "/../../go.mod", 404, ""},
	} {
		t.Run(test.method+test.url, func(t *testing.T) {
			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest(test.method, test.url, nil))
			if response.Code != test.status {
				t.Fatalf("status = %d, want %d", response.Code, test.status)
			}
			if test.status == 200 && response.Body.String() != test.body {
				t.Fatalf("body = %q, want %q", response.Body.String(), test.body)
			}
			if test.url == "/" && test.method == "GET" {
				if !strings.Contains(response.Header().Get("Content-Type"), "text/html") || response.Header().Get("Cache-Control") != "no-cache" {
					t.Fatalf("unexpected index headers: %v", response.Header())
				}
			}
		})
	}
}

func TestServeFrontendRequiresBuild(t *testing.T) {
	if err := serveFrontend(gin.New(), t.TempDir()); err == nil {
		t.Fatal("expected an error for missing index.html")
	}
}
