# Web search

Vitruvius can use `web_search` through an instance of [SearXNG](https://docs.searxng.org/). Searches go only to the URL you configure; SearXNG then queries the engines enabled on that instance.

## Start SearXNG with Docker

```sh
docker run -d --name searxng --restart unless-stopped -p 8080:8080 \
  -e SEARXNG_BASE_URL=http://localhost:8080/ \
  -e SEARXNG_SECRET="$(openssl rand -hex 32)" \
  docker.io/searxng/searxng:latest
```

Enable JSON responses in the instance's `settings.yml` under `search.formats` (the default commonly includes only HTML):

```yaml
search:
  formats:
    - html
    - json
```

SearXNG documents the [search API](https://docs.searxng.org/dev/search_api.html) and [available result formats](https://docs.searxng.org/admin/settings/settings_search.html).

## Connect Atelier

Open **Settings → Model roles → Web search**, enter the instance URL such as `http://localhost:8080`, then save. An optional fallback URL is tried if the primary instance is unreachable, times out, or returns an error.

You can configure the primary URL with `ATELIER_SEARCH_URL` and the optional fallback with `ATELIER_SEARCH_FALLBACK_URL` in the environment instead. Environment values take precedence over saved settings.

With no URL configured, the `web_search` tool reports **web search is not configured**. For example, ask Vitruvius a factual question and it can return search results with their source URLs when SearXNG is available.
