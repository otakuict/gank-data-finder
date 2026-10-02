package main

import (
	"fmt"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
)

// serveFrontend exposes only built frontend files; missing APIs and assets stay 404.
func serveFrontend(router *gin.Engine, directory string) error {
	index, err := os.Stat(filepath.Join(directory, "index.html"))
	if err != nil {
		return fmt.Errorf("load frontend index: %w", err)
	}
	if !index.Mode().IsRegular() {
		return fmt.Errorf("frontend index.html must be a regular file")
	}
	files := http.Dir(directory)
	server := http.FileServer(files)
	router.NoRoute(func(c *gin.Context) {
		urlPath := path.Clean("/" + c.Request.URL.Path)
		if (c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead) ||
			urlPath == "/api" || strings.HasPrefix(urlPath, "/api/") {
			c.Status(http.StatusNotFound)
			return
		}
		name := urlPath
		if name == "/" {
			name = "/index.html"
		}
		file, err := files.Open(name)
		if err != nil {
			c.Status(http.StatusNotFound)
			return
		}
		defer file.Close()
		info, err := file.Stat()
		if err != nil || !info.Mode().IsRegular() {
			c.Status(http.StatusNotFound)
			return
		}
		if name == "/index.html" {
			c.Header("Cache-Control", "no-cache")
		}
		// Gin sets 404 before calling NoRoute; reset it for successful file responses.
		c.Status(http.StatusOK)
		server.ServeHTTP(c.Writer, c.Request)
	})
	return nil
}
