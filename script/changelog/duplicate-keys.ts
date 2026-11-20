/**
 * Keys that appear twice in one JSON object, as the path of the object and the
 * key. `JSON.parse` keeps the last of two equal keys without a word, so a
 * release that is listed twice in changelog.json would show only the entry
 * that comes last (#122).
 */
export function findDuplicateKeys(text: string): ReadonlyArray<string> {
  interface IFrame {
    readonly isObject: boolean
    readonly keys: Set<string>
    expectKey: boolean
    key: string
  }

  const duplicates = new Array<string>()
  const stack = new Array<IFrame>()
  const pathOf = () =>
    stack
      .filter(f => f.isObject)
      .map(f => f.key)
      .slice(0, -1)
      .join('.')

  let i = 0
  while (i < text.length) {
    const c = text[i]

    if (c === '"') {
      // A string: read to its closing quote.
      let j = i + 1
      let value = ''
      while (j < text.length && text[j] !== '"') {
        if (text[j] === '\\') {
          value += text[j] + (text[j + 1] ?? '')
          j += 2
        } else {
          value += text[j]
          j++
        }
      }

      const top = stack[stack.length - 1]
      if (top !== undefined && top.isObject && top.expectKey) {
        if (top.keys.has(value)) {
          const path = pathOf()
          duplicates.push(path === '' ? value : `${path}.${value}`)
        }
        top.keys.add(value)
        top.key = value
        top.expectKey = false
      }

      i = j + 1
      continue
    }

    if (c === '{') {
      stack.push({ isObject: true, keys: new Set(), expectKey: true, key: '' })
    } else if (c === '[') {
      stack.push({
        isObject: false,
        keys: new Set(),
        expectKey: false,
        key: '',
      })
    } else if (c === '}' || c === ']') {
      stack.pop()
    } else if (c === ',') {
      const top = stack[stack.length - 1]
      if (top !== undefined && top.isObject) {
        top.expectKey = true
      }
    }

    i++
  }

  return duplicates
}
