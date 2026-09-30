package types

type SearchSource string
type MatchMode string

const (
	SourcePosts SearchSource = "posts"
	SourceShop  SearchSource = "shop"
	SourceBoth  SearchSource = "both"
	ModeExact   MatchMode    = "exact"
	ModeBroad   MatchMode    = "broad"
)

type SearchParams struct {
	Seller          string
	Date            string
	Name            string
	Count           *int
	Source          SearchSource
	IncludeInactive bool
	Mode            MatchMode
}

type ExtractedCount struct {
	Value       int    `json:"value"`
	Approximate bool   `json:"approximate"`
	Raw         string `json:"raw"`
}

type SearchResult struct {
	ID                 string          `json:"id"`
	Seller             string          `json:"seller"`
	Source             string          `json:"source"`
	Title              string          `json:"title"`
	CreatedAt          *string         `json:"createdAt"`
	FileCount          *ExtractedCount `json:"fileCount"`
	Status             string          `json:"status"`
	Excerpt            string          `json:"excerpt"`
	PostURL            *string         `json:"postUrl"`
	ShopURL            *string         `json:"shopUrl"`
	ExternalURL        *string         `json:"externalUrl"`
	PreviewURL         *string         `json:"previewUrl"`
	PreviewUnavailable bool            `json:"previewUnavailable"`
	MatchExplanation   string          `json:"matchExplanation"`
	Rank               int             `json:"rank"`
}
