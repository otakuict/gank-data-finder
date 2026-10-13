#!/usr/bin/env bash
set -Eeuo pipefail

image="${1:?Pass the image tag to deploy}"
container=gankfinder-app-v2
backup=gankfinder-app-v2-previous
proxy=gankfinder-nginx
network=gankfinder-net
had_previous=false
new_started=false

exec 9>/tmp/gankfinder-deploy.lock
flock -n 9 || { echo 'Another finder deployment is running.' >&2; exit 1; }

docker image inspect "$image" >/dev/null
docker network inspect "$network" >/dev/null
if [[ "$(docker inspect --format '{{.State.Running}}' "$proxy")" != true ]]; then
  echo "The existing Nginx proxy is not running: $proxy" >&2
  exit 1
fi
docker exec "$proxy" nginx -t >/dev/null

# An existing backup indicates an interrupted deployment. Keep it for recovery.
if docker container inspect "$backup" >/dev/null 2>&1; then
  echo "A previous backup container exists: $backup" >&2
  exit 1
fi

on_exit() {
  status=$?
  if (( status == 0 )); then
    return
  fi
  trap - EXIT
  echo 'Deployment failed; restoring the previous container.' >&2
  if [[ "$new_started" == true ]]; then
    docker rm -f "$container" >/dev/null 2>&1 || true
  fi
  if [[ "$had_previous" == true ]]; then
    docker rename "$backup" "$container" && docker start "$container" >/dev/null || {
      echo "Automatic recovery failed; inspect $container and $backup." >&2
    }
  fi
  docker exec "$proxy" nginx -t && docker exec "$proxy" nginx -s reload || {
    echo "Could not reload $proxy after recovery; inspect its upstream." >&2
  }
  exit "$status"
}
trap on_exit EXIT

if docker container inspect "$container" >/dev/null 2>&1; then
  docker rename "$container" "$backup"
  had_previous=true
  docker stop "$backup" >/dev/null
fi

new_started=true
docker run -d \
  --name "$container" \
  --network "$network" \
  --network-alias gankfinder_app \
  --restart unless-stopped \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  "$image" >/dev/null

for attempt in {1..30}; do
  status="$(docker inspect --format '{{.State.Health.Status}}' "$container")"
  if [[ "$status" == healthy ]]; then
    docker exec "$proxy" nginx -t
    docker exec "$proxy" nginx -s reload
    for proxy_attempt in {1..15}; do
      if curl --fail --silent --show-error --max-time 5 \
        http://127.0.0.1:3001/api/health >/dev/null 2>&1; then
        if [[ "$had_previous" == true ]]; then
          docker rm "$backup" >/dev/null
        fi
        echo "Deployed $image through $proxy and passed the health check."
        exit 0
      fi
      sleep 2
    done
    echo 'The Nginx route did not become healthy after reload.' >&2
    exit 1
  fi
  if [[ "$status" == unhealthy ]]; then
    echo 'The new container is unhealthy.' >&2
    exit 1
  fi
  sleep 3
done

echo 'The new container did not become healthy within 90 seconds.' >&2
exit 1
