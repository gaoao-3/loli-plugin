function candidateOf (response) {
  return response?.candidates?.[0]
}

export function isPureTextTruncation (response) {
  const candidate = candidateOf(response)
  const parts = candidate?.content?.parts
  return candidate?.finishReason === 'MAX_TOKENS' &&
    Array.isArray(parts) &&
    parts.length > 0 &&
    parts.every(part => part && typeof part === 'object' &&
      Object.hasOwn(part, 'text') && !part.functionCall && !part.functionResponse)
}

export function buildContinuationContents (contents, response, instruction = '请继续') {
  const parts = candidateOf(response)?.content?.parts || []
  return [
    ...contents,
    { role: 'model', parts: structuredClone(parts) },
    { role: 'user', parts: [{ text: instruction }] }
  ]
}

function mergeUsage (left = {}, right = {}) {
  const merged = { ...left }
  for (const [key, value] of Object.entries(right || {})) {
    const leftValue = Number(merged[key])
    const rightValue = Number(value)
    merged[key] = Number.isFinite(leftValue) && Number.isFinite(rightValue)
      ? leftValue + rightValue
      : value
  }
  return merged
}

export function mergeTruncatedResponses (previous, next) {
  const previousCandidate = candidateOf(previous)
  const nextCandidate = candidateOf(next)
  if (!previousCandidate || !nextCandidate) return next || previous
  return {
    ...previous,
    ...next,
    candidates: [{
      ...previousCandidate,
      ...nextCandidate,
      content: {
        ...(previousCandidate.content || {}),
        ...(nextCandidate.content || {}),
        parts: [
          ...(previousCandidate.content?.parts || []),
          ...(nextCandidate.content?.parts || [])
        ]
      }
    }, ...(next.candidates || []).slice(1)],
    usageMetadata: mergeUsage(previous.usageMetadata, next.usageMetadata)
  }
}
