#!/usr/bin/env bash
#
# Agent Orchestrator 一键部署脚本
#
# 用法：
#   bash scripts/deploy.sh install           安装（依赖 + CLI 入口 + 可执行 symlink）
#   bash scripts/deploy.sh upgrade [--no-restart]   升级（拉取最新代码 + 重建 + 重启 daemon）
#   bash scripts/deploy.sh uninstall [--purge]      卸载（停止 daemon + 移除入口；--purge 同时删数据）
#   bash scripts/deploy.sh status             查看安装状态
#   bash scripts/deploy.sh help               帮助
#
# 环境变量（可覆盖，便于测试/自定义路径）：
#   AGENT_DEPLOY_HOME    CLI 包装目录（默认 $HOME/.agent-orchestrator）
#   AGENT_TARGET_DIR     可执行文件 symlink 目录（默认自动检测 ~/.local/bin / ~/bin / /usr/local/bin）
#   AGENT_NO_RESTART=1   upgrade 时不重启 daemon
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BIN_DIR="${AGENT_DEPLOY_HOME:-$HOME/.agent-orchestrator}/bin"
MIN_NODE_MAJOR=24

log()  { printf '\033[1;36m[deploy]\033[0m %s\n' "$*"; }
log_ok() { printf '\033[1;32m[deploy]\033[0m %s\n' "$*"; }
log_warn() { printf '\033[1;33m[deploy]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m[deploy] 错误:\033[0m %s\n' "$*" >&2; exit 1; }

require_node() {
  if ! command -v node >/dev/null 2>&1; then
    die "未找到 node。请先安装 Node.js >= $MIN_NODE_MAJOR（推荐 26）：https://nodejs.org"
  fi
  local major
  major="$(node -e 'process.stdout.write(String(process.versions.node.split(".")[0]))')"
  if [ "$major" -lt "$MIN_NODE_MAJOR" ]; then
    die "Node 版本过低：当前 $major，需要 >= $MIN_NODE_MAJOR（本项目依赖 Node 原生 TS 运行与 node:sqlite）"
  fi
}

require_pnpm() {
  if ! command -v pnpm >/dev/null 2>&1; then
    die "未找到 pnpm。请先安装：npm install -g pnpm（或 corepack enable && corepack prepare pnpm@latest --activate）"
  fi
}

detect_target_dir() {
  if [ -n "${AGENT_TARGET_DIR:-}" ]; then
    printf '%s' "$AGENT_TARGET_DIR"
    return
  fi
  local d
  for d in "$HOME/.local/bin" "$HOME/bin"; do
    if [ -d "$d" ] && [ -w "$d" ]; then
      printf '%s' "$d"
      return
    fi
  done
  if [ -w /usr/local/bin ] 2>/dev/null; then
    printf '%s' /usr/local/bin
    return
  fi
  printf '%s' "$HOME/.local/bin"
}

install_entry() {
  log "创建 CLI 入口 $BIN_DIR/agent"
  mkdir -p "$BIN_DIR"
  local node_bin
  node_bin="$(command -v node)"
  cat > "$BIN_DIR/agent" <<EOF
#!/usr/bin/env bash
exec "$node_bin" "$REPO_DIR/src/cli/index.ts" "\$@"
EOF
  chmod +x "$BIN_DIR/agent"

  local target_dir
  target_dir="$(detect_target_dir)"
  mkdir -p "$target_dir"
  log "创建命令 symlink $target_dir/agent"
  ln -sfn "$BIN_DIR/agent" "$target_dir/agent"

  if ! printf '%s' "$PATH" | tr ':' '\n' | grep -qx "$target_dir"; then
    log_warn "注意：$target_dir 不在 PATH 中。请执行以下命令后重开终端："
    printf '        export PATH="%s:$PATH"\n' "$target_dir"
  fi
}

install_deps() {
  log "安装依赖…"
  (cd "$REPO_DIR" && pnpm install --frozen-lockfile) || (cd "$REPO_DIR" && pnpm install)
  log "类型检查…"
  (cd "$REPO_DIR" && pnpm typecheck)
}

cmd_install() {
  require_node
  require_pnpm
  install_deps
  install_entry
  log "验证…"
  "$BIN_DIR/agent" --version
  log_ok "安装完成。常用命令："
  printf '        agent daemon start                启动后台守护进程\n'
  printf '        agent chat                        交互式对话（免费模型分析路由 + 会话管理）\n'
  printf '        agent model add ...               添加模型（初始注册表为空）\n'
}

cmd_upgrade() {
  require_node
  require_pnpm
  if git -C "$REPO_DIR" remote get-url origin >/dev/null 2>&1; then
    log "拉取最新代码…"
    git -C "$REPO_DIR" pull --ff-only || log_warn "git pull 失败，将基于当前仓库内容继续升级"
  else
    log_warn "仓库未配置 git remote，无法自动拉取；请手动更新仓库后重试"
  fi
  install_deps
  install_entry
  if [ "$NO_RESTART" != "1" ]; then
    log "重启 daemon（加载新代码）…"
    "$BIN_DIR/agent" daemon stop >/dev/null 2>&1 || true
    "$BIN_DIR/agent" daemon start || log_warn "daemon 启动失败，可稍后手动执行 agent daemon start"
  fi
  log "验证…"
  "$BIN_DIR/agent" --version
  log_ok "升级完成"
}

cmd_uninstall() {
  if [ -x "$BIN_DIR/agent" ]; then
    log "停止 daemon…"
    "$BIN_DIR/agent" daemon stop >/dev/null 2>&1 || true
  fi
  local target_dir
  target_dir="$(detect_target_dir)"
  if [ -e "$target_dir/agent" ]; then
    log "移除命令 $target_dir/agent"
    rm -f "$target_dir/agent"
  fi
  if [ -d "$BIN_DIR" ]; then
    log "移除 CLI 入口 $BIN_DIR"
    rm -rf "$BIN_DIR"
  fi
  if [ "$PURGE" = "1" ]; then
    log "删除数据目录 $REPO_DIR/.agent-orchestrator"
    rm -rf "$REPO_DIR/.agent-orchestrator"
    log_ok "已删除全部数据（任务/会话/模型注册表/日志）"
  else
    log "保留数据目录 $REPO_DIR/.agent-orchestrator（任务/会话/模型注册表）；如需一并删除请加 --purge"
  fi
  log_ok "卸载完成"
}

cmd_status() {
  printf '仓库目录: %s\n' "$REPO_DIR"
  printf 'CLI 入口: %s\n' "$BIN_DIR/agent"
  if [ -x "$BIN_DIR/agent" ]; then
    printf 'CLI 版本: '
    "$BIN_DIR/agent" --version 2>/dev/null || printf '（执行失败）\n'
  else
    printf 'CLI 版本: 未安装\n'
  fi
  if command -v node >/dev/null 2>&1; then printf 'Node:     %s\n' "$(node --version)"; else printf 'Node:     未安装\n'; fi
  if command -v pnpm >/dev/null 2>&1; then printf 'pnpm:     %s\n' "$(pnpm --version)"; else printf 'pnpm:     未安装\n'; fi
  printf 'daemon:   '
  if [ -x "$BIN_DIR/agent" ]; then
    "$BIN_DIR/agent" daemon status 2>/dev/null || printf '未知\n'
  else
    printf '未安装\n'
  fi
}

cmd_help() {
  sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
}

PURGE=0
NO_RESTART=0
CMD="${1:-help}"
shift || true
for arg in "$@"; do
  case "$arg" in
    --purge) PURGE=1 ;;
    --no-restart) NO_RESTART=1 ;;
    *) log_warn "忽略未知参数：$arg" ;;
  esac
done

case "$CMD" in
  install) cmd_install ;;
  upgrade) cmd_upgrade ;;
  uninstall) cmd_uninstall ;;
  status) cmd_status ;;
  help|--help|-h) cmd_help ;;
  *) log_warn "未知命令：$CMD"; cmd_help; exit 1 ;;
esac
