// Post-processes whisper transcription output:
// removes filler words, normalizes whitespace, fixes capitalization.

// Filler patterns — matched as whole words, case-insensitive.
// Only remove words that are clearly fillers (conservative).
const FILLER_PATTERNS = [
  /\b(?:um|uh|uhh|umm|hmm|hm)\b/gi,
  /\b(?:you know)\b/gi,
  /\b(?:I mean)\b/gi,
  /\b(?:so basically)\b/gi,
  /\b(?:sort of|kind of)\b/gi,
  // "like" as filler: at start of sentence, after comma, or surrounded by commas
  /(?:^|[,.])\s*like\s*(?=[,.]|\s+[a-z])/gi,
  // "actually" as filler at start of sentence
  /^actually[,.]?\s*/gi,
  // "right" and "okay" as fillers at start
  /^(?:right|okay|ok)[,.]?\s*/gi
]

/**
 * Clean up whisper transcription output.
 * Removes filler words, normalizes whitespace, fixes capitalization.
 */
export function cleanTranscription(raw: string): string {
  let text = raw.trim()

  if (!text) return ''

  // Remove filler words
  for (const pattern of FILLER_PATTERNS) {
    text = text.replace(pattern, ' ')
  }

  // Collapse multiple spaces/punctuation artifacts
  text = text.replace(/\s{2,}/g, ' ')
  text = text.replace(/\s+([,.])/g, '$1')
  text = text.replace(/([,.])\s*([,.])/g, '$1')

  // Fix capitalization after removals: capitalize first letter
  text = text.trim()
  if (text.length > 0) {
    text = text[0].toLowerCase() + text.slice(1)
  }

  // Remove leading/trailing punctuation artifacts
  text = text.replace(/^[,.\s]+/, '').replace(/[,\s]+$/, '')

  return text
}
