#!/usr/bin/env bash
# Catatan rilis yang bisa dibaca manusia, dari pesan commit sejak tag terakhir.
#   feat: … → Fitur baru, fix: … → Perbaikan, lainnya → Perubahan lain.
# Baris "- …" di badan commit ikut sebagai rincian. Commit bot pembaruan versi
# dan ci:/chore: dilewati karena tidak mengubah apa yang dipakai pengguna.
#
#   bash .github/catatan-rilis.sh v0.4.0 > notes.md
set -euo pipefail
last="${1:-}"
range="${last:+$last..}HEAD"
feat="" fix="" lain=""
for h in $(git log --reverse --format=%H "$range"); do
  subj=$(git log -1 --format=%s "$h")
  case "$subj" in
    "docs: perbarui versi"* | "Perbarui versi"* | ci:* | ci\(* | chore:* | chore\(*) continue ;;
  esac
  text=$(printf '%s' "$subj" | sed -E 's/^[a-z]+(\([^)]*\))?!?: //')
  entry="- ${text} (${h:0:7})"$'\n'
  body=$(git log -1 --format=%b "$h" | grep -E '^- ' | sed 's/^/  /' || true)
  [ -n "$body" ] && entry+="$body"$'\n'
  if [[ $subj =~ ^feat(\([^\)]*\))?!?: ]]; then feat+="$entry"
  elif [[ $subj =~ ^fix(\([^\)]*\))?!?: ]]; then fix+="$entry"
  else lain+="$entry"
  fi
done
echo "## Perubahan"
echo
[ -z "$feat$fix$lain" ] && { echo "Tidak ada perubahan yang tercatat."; echo; }
[ -n "$feat" ] && printf '### Fitur baru\n\n%s\n' "$feat"
[ -n "$fix" ] && printf '### Perbaikan\n\n%s\n' "$fix"
[ -n "$lain" ] && printf '### Perubahan lain\n\n%s\n' "$lain"
exit 0
