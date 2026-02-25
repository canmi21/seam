/* examples/github-dashboard/backends/go-gin/procedures.go */

package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"

	seam "github.com/canmi21/seam/packages/server/core/go"
)

func GetSession() seam.ProcedureDef {
	return seam.ProcedureDef{
		Name:         "getSession",
		InputSchema:  json.RawMessage(`{"properties":{}}`),
		OutputSchema: json.RawMessage(`{"properties":{"username":{"type":"string"},"theme":{"type":"string"}}}`),
		Handler: func(input json.RawMessage) (json.RawMessage, error) {
			return json.Marshal(map[string]string{"username": "visitor", "theme": "light"})
		},
	}
}

func GetHomeData() seam.ProcedureDef {
	return seam.ProcedureDef{
		Name:         "getHomeData",
		InputSchema:  json.RawMessage(`{"properties":{}}`),
		OutputSchema: json.RawMessage(`{"properties":{"tagline":{"type":"string"}}}`),
		Handler: func(input json.RawMessage) (json.RawMessage, error) {
			return json.Marshal(map[string]string{"tagline": "Compile-Time Rendering for React"})
		},
	}
}

func GetUser() seam.ProcedureDef {
	return seam.ProcedureDef{
		Name:         "getUser",
		InputSchema:  json.RawMessage(`{"properties":{"username":{"type":"string"}}}`),
		OutputSchema: json.RawMessage(`{"properties":{"login":{"type":"string"},"avatar_url":{"type":"string"},"public_repos":{"type":"uint32"},"followers":{"type":"uint32"},"following":{"type":"uint32"}},"optionalProperties":{"name":{"type":"string","nullable":true},"bio":{"type":"string","nullable":true},"location":{"type":"string","nullable":true}}}`),
		Handler: func(input json.RawMessage) (json.RawMessage, error) {
			var req struct {
				Username string `json:"username"`
			}
			if err := json.Unmarshal(input, &req); err != nil {
				return nil, err
			}
			apiURL := fmt.Sprintf("https://api.github.com/users/%s", url.PathEscape(req.Username))
			resp, err := http.Get(apiURL)
			if err != nil {
				return nil, fmt.Errorf("GitHub API error: %w", err)
			}
			defer resp.Body.Close()
			body, _ := io.ReadAll(resp.Body)
			if resp.StatusCode != 200 {
				return nil, fmt.Errorf("GitHub API %d: %s", resp.StatusCode, string(body))
			}
			var data map[string]interface{}
			json.Unmarshal(body, &data)

			result := map[string]interface{}{
				"login":        data["login"],
				"name":         data["name"],
				"avatar_url":   data["avatar_url"],
				"bio":          data["bio"],
				"location":     data["location"],
				"public_repos": uint32(toFloat(data["public_repos"])),
				"followers":    uint32(toFloat(data["followers"])),
				"following":    uint32(toFloat(data["following"])),
			}
			return json.Marshal(result)
		},
	}
}

func GetUserRepos() seam.ProcedureDef {
	return seam.ProcedureDef{
		Name:         "getUserRepos",
		InputSchema:  json.RawMessage(`{"properties":{"username":{"type":"string"}}}`),
		OutputSchema: json.RawMessage(`{"elements":{"properties":{"id":{"type":"uint32"},"name":{"type":"string"},"stargazers_count":{"type":"uint32"},"forks_count":{"type":"uint32"},"html_url":{"type":"string"}},"optionalProperties":{"description":{"type":"string","nullable":true},"language":{"type":"string","nullable":true}}}}`),
		Handler: func(input json.RawMessage) (json.RawMessage, error) {
			var req struct {
				Username string `json:"username"`
			}
			if err := json.Unmarshal(input, &req); err != nil {
				return nil, err
			}
			apiURL := fmt.Sprintf("https://api.github.com/users/%s/repos?sort=stars&per_page=6", url.PathEscape(req.Username))
			resp, err := http.Get(apiURL)
			if err != nil {
				return nil, fmt.Errorf("GitHub API error: %w", err)
			}
			defer resp.Body.Close()
			body, _ := io.ReadAll(resp.Body)
			if resp.StatusCode != 200 {
				return nil, fmt.Errorf("GitHub API %d: %s", resp.StatusCode, string(body))
			}
			var repos []map[string]interface{}
			json.Unmarshal(body, &repos)

			var result []map[string]interface{}
			for _, r := range repos {
				result = append(result, map[string]interface{}{
					"id":               uint32(toFloat(r["id"])),
					"name":             r["name"],
					"description":      r["description"],
					"language":         r["language"],
					"stargazers_count": uint32(toFloat(r["stargazers_count"])),
					"forks_count":      uint32(toFloat(r["forks_count"])),
					"html_url":         r["html_url"],
				})
			}
			return json.Marshal(result)
		},
	}
}

func toFloat(v interface{}) float64 {
	if f, ok := v.(float64); ok {
		return f
	}
	return 0
}
