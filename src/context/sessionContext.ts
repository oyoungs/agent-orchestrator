// 会话上下文：每轮「输入+输出」自动累积，携带到下一轮

export const DEFAULT_SESSION_CONTEXT_LIMIT = 12_000;
export const PROMPT_CONTEXT_LIMIT = 12_000;

export function formatTurn(prompt: string, result: string): string {
  return `用户: ${prompt.trim()}\n结果: ${result.trim()}`;
}

/** 保留最新内容，超限时从头部截断 */
export function truncateFront(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const head = "[较早对话已截断]\n";
  if (limit <= head.length) return head.slice(0, limit);
  return head + text.slice(text.length - (limit - head.length));
}

export function appendTurn(
  context: string,
  prompt: string,
  result: string,
  limit = DEFAULT_SESSION_CONTEXT_LIMIT,
): string {
  const turn = formatTurn(prompt, result);
  const next = context.trim() ? `${context.trim()}\n\n${turn}` : turn;
  return truncateFront(next, limit);
}

/** 构建发给模型的上下文前缀；空上下文返回 undefined */
export function buildContextPrompt(context: string, limit = PROMPT_CONTEXT_LIMIT): string | undefined {
  const trimmed = context.trim();
  if (!trimmed) return undefined;
  return `[历史会话]\n${truncateFront(trimmed, limit)}`;
}
