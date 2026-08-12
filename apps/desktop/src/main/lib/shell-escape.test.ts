import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { shellEscape } from './shell-escape'

// ─── Shell escaping ──────────────────────────────────────────────────────────
//
// The literal-output assertions pin the '\'' idiom, but they only prove the
// function does what we wrote — not that a shell agrees. So every interesting
// input is also round-tripped through a real `sh -c`, which is the only
// authority on whether an escape actually holds. If `sh` echoes the input back
// byte for byte, nothing in the string was interpreted.

/** Runs `printf %s <escaped>` through a real shell and returns exactly what it printed. */
function roundTrip(input: string): string {
  return execFileSync('/bin/sh', ['-c', `printf %s ${shellEscape(input)}`], {
    encoding: 'utf-8'
  })
}

/** Asserts the shell treats the escaped form as one argument with the exact value. */
function expectSurvivesShell(input: string): void {
  expect(roundTrip(input)).toBe(input)

  // A second check that a metacharacter did not split the string into extra
  // words: `set -- <escaped>` must produce exactly one positional parameter.
  const argc = execFileSync('/bin/sh', ['-c', `set -- ${shellEscape(input)}; printf %s "$#"`], {
    encoding: 'utf-8'
  })
  expect(argc).toBe('1')
}

describe('shellEscape', () => {
  describe('quoting form', () => {
    it('wraps a plain word in single quotes', () => {
      expect(shellEscape('hello')).toBe("'hello'")
    })

    it('quotes the empty string into an explicit empty argument', () => {
      // Without the quotes this would vanish from the command line entirely.
      expect(shellEscape('')).toBe("''")
      expect(
        execFileSync('/bin/sh', ['-c', `set -- ${shellEscape('')}; printf %s "$#"`], {
          encoding: 'utf-8'
        })
      ).toBe('1')
    })

    it('escapes a single quote with the end-quote/literal/start-quote idiom', () => {
      expect(shellEscape("it's")).toBe("'it'\\''s'")
    })

    it('escapes every single quote, not just the first', () => {
      expect(shellEscape("a'b'c")).toBe("'a'\\''b'\\''c'")
    })
  })

  describe('paths', () => {
    it('handles spaces', () => {
      expect(shellEscape('/Users/ada/My Projects/app')).toBe("'/Users/ada/My Projects/app'")
      expectSurvivesShell('/Users/ada/My Projects/app')
    })

    it('handles single quotes', () => {
      expectSurvivesShell("/Users/ada/Ada's Projects/app")
    })

    it('handles double quotes', () => {
      expect(shellEscape('/tmp/say "hi"')).toBe("'/tmp/say \"hi\"'")
      expectSurvivesShell('/tmp/say "hi"')
    })

    it('handles both quote kinds at once', () => {
      expectSurvivesShell(`mixed '"' quotes`)
    })

    it('handles a leading dash without it becoming a flag value', () => {
      // Quoting cannot stop a program parsing `-rf` as a flag — that is the
      // caller's job via `--` — but the shell must still pass it as one word.
      expectSurvivesShell('--dangerous')
    })
  })

  describe('shell metacharacters', () => {
    const metacharacters: ReadonlyArray<readonly [string, string]> = [
      ['command substitution, backticks', 'a `whoami` b'],
      ['command substitution, dollar-paren', 'a $(whoami) b'],
      ['variable expansion', 'a $HOME b'],
      ['brace expansion', 'a ${HOME} b'],
      ['command separator', 'a; rm -rf /'],
      ['background operator', 'a & rm -rf /'],
      ['and-list', 'a && rm -rf /'],
      ['or-list', 'a || rm -rf /'],
      ['pipe', 'a | rm -rf /'],
      ['output redirect', 'a > /tmp/pwned'],
      ['append redirect', 'a >> /tmp/pwned'],
      ['input redirect', 'a < /etc/passwd'],
      ['glob star', 'a * b'],
      ['glob question mark', 'a ? b'],
      ['bracket glob', 'a [a-z] b'],
      ['brace list', 'a {b,c} d'],
      ['tilde expansion', '~/secrets'],
      ['backslash', 'a\\b'],
      ['trailing backslash', 'a\\'],
      ['newline', 'a\nrm -rf /'],
      ['carriage return', 'a\rb'],
      ['tab', 'a\tb'],
      ['history expansion', 'a !! b'],
      ['comment marker', 'a # not a comment'],
      ['parentheses', 'a (subshell) b'],
      ['equals and colon', 'FOO=bar:baz'],
      ['unicode', 'café — naïve 🐙'],
      ['quote-escape lookalike', `end'\\''start`],
      ['nested escape attempt', `'; rm -rf / #`]
    ]

    it.each(metacharacters)('neutralises %s', (_label, input) => {
      expectSurvivesShell(input)
    })

    it('does not let an embedded quote break out and run a command', () => {
      // The classic injection: if the escape leaked, `sh` would create this file.
      const escaped = shellEscape("x'; touch /tmp/braid-shell-escape-pwned; echo '")
      const output = execFileSync('/bin/sh', ['-c', `printf %s ${escaped}`], {
        encoding: 'utf-8'
      })

      expect(output).toBe("x'; touch /tmp/braid-shell-escape-pwned; echo '")
      expect(existsSync('/tmp/braid-shell-escape-pwned')).toBe(false)
    })
  })

  describe('determinism', () => {
    it('is idempotent in the sense that escaping twice still round-trips once', () => {
      // Double-escaping is a bug at the call site, not here — but it must at
      // least be lossless so the mistake is visible rather than dangerous.
      const once = shellEscape("it's")
      expect(roundTrip(once)).toBe(once)
    })

    it('never returns an unquoted string', () => {
      for (const input of ['', 'plain', "quo'te", '$(x)', 'a b']) {
        const escaped = shellEscape(input)
        expect(escaped.startsWith("'")).toBe(true)
        expect(escaped.endsWith("'")).toBe(true)
      }
    })
  })
})
