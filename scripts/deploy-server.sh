#!/usr/bin/env bash
set -Eeuo pipefail

image="${1:?Pass the image tag to deploy}"
container=gank-post-finder
backup=gank-post-finder-previous
had_previous=false
previous_image=

docker image inspect "$image" >/dev/null

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
  docker rm -f "$container" >/dev/null 2>&1 || true
  if [[ "$had_previous" == true ]]; then
    docker rename "$backup" "$container" || true
    docker start "$container" >/dev/null || true
  fi
}
trap on_exit EXIT

if docker container inspect "$container" >/dev/null 2>&1; then
  previous_image="$(docker inspect --format '{{.Image}}' "$container")"
  docker rename "$container" "$backup"
  had_previous=true
  docker stop "$backup" >/dev/null
fi

docker run -d \
  --name "$container" \
  --restart unless-stopped \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  -p 3001:3001 \
  "$image" >/dev/null

for attempt in {1..30}; do
  status="$(docker inspect --format '{{.State.Health.Status}}' "$container")"
  if [[ "$status" == healthy ]]; then
    if [[ "$had_previous" == true ]]; then
      docker rm "$backup" >/dev/null
      docker image rm "$previous_image" >/dev/null 2>&1 || true
    fi
    echo "Deployed $image and passed the health check."
    exit 0
  fi
  if [[ "$status" == unhealthy ]]; then
    echo 'The new container is unhealthy.' >&2
    exit 1
  fi
  sleep 3
done

echo 'The new container did not become healthy within 90 seconds.' >&2
exit 1
