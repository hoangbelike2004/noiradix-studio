#!/bin/bash
# Prefer the portable runtime; also support source checkouts with Node installed.
STUDIO_DIR="$(cd "$(dirname "$0")" && pwd -P)" || exit 1
cd "$STUDIO_DIR" || exit 1
case "$(uname -m)" in
  arm64|aarch64) STUDIO_ARCH=arm64 ;;
  *) STUDIO_ARCH=x64 ;;
esac
STUDIO_NODE="$STUDIO_DIR/runtime/darwin-$STUDIO_ARCH/node"
if [ ! -x "$STUDIO_NODE" ]; then
  STUDIO_NODE="$(command -v node)"
  if [ -z "$STUDIO_NODE" ]; then
    for STUDIO_CANDIDATE in /opt/homebrew/bin/node /usr/local/bin/node; do
      if [ -x "$STUDIO_CANDIDATE" ]; then STUDIO_NODE="$STUDIO_CANDIDATE"; break; fi
    done
  fi
fi
if [ -z "$STUDIO_NODE" ] || ! "$STUDIO_NODE" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' >/dev/null 2>&1; then
  echo "Máy chưa có bộ chạy phù hợp."
  echo "Nếu nhận bản ZIP portable: hãy giải nén toàn bộ, giữ nguyên thư mục runtime rồi mở lại."
  echo "Nếu dùng bản mã nguồn: cài Node.js LTS từ trang đang mở, rồi nhấp đúp file này lần nữa."
  /usr/bin/open 'https://nodejs.org/en/download'
  read -r -p 'Nhấn Enter để đóng… ' STUDIO_REPLY
  exit 1
fi
# Keep the error handler inline: macOS can block reading even the entry module
# on Desktop before any of its JavaScript has a chance to handle the error.
# exec preserves direct delivery of Terminal's close/Ctrl+C to the server.
exec "$STUDIO_NODE" --input-type=module -e '
import { pathToFileURL } from "node:url";
try {
  await import(pathToFileURL(process.argv[1]).href);
} catch (error) {
  if (["EPERM", "EACCES"].includes(error.code)) {
    console.error("\nStudio chưa được phép đọc thư mục dự án trên máy này.");
    console.error("Nếu dự án nằm trên Desktop: mở System Settings → Privacy & Security");
    console.error("→ Files & Folders → Terminal → bật Desktop Folder.");
    console.error("Sau đó thoát hẳn Terminal bằng ⌘Q và nhấp đúp file mở Studio lần nữa.");
    console.error("Nếu dự án nằm trong Documents hoặc Downloads, bật quyền cho thư mục tương ứng.");
    console.error("Hoặc dùng Finder chuyển toàn bộ thư mục dự án vào thư mục chính của bạn");
    console.error("(Go → Home), bên ngoài Desktop, Documents và Downloads, rồi mở lại.");
    console.error("\nFile bị chặn: " + (error.path || process.argv[1]));
  } else {
    console.error("Không mở được Studio: " + error.message);
  }
  process.exitCode = 1;
}
' "$STUDIO_DIR/tools/launch-studio.mjs" "$@"
