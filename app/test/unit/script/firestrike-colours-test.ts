import { describe, it } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'fs'
import * as Path from 'path'
import {
  compareColours,
  parseColours,
} from '../../../../script/firestrike-colours'

describe('parseColours', () => {
  it('reads colour variables, in lower case, and ignores the rest', () => {
    const colours = parseColours(`
// $fs-comment: #123456;
/// doc
$fs-grund: #EFF0ED;
$fs-sans: ui-sans-serif, system-ui;
$fs-hell: (
  grund: #ffffff,
);
  $fs-glut: #a24c18; // trailing comment
`)

    assert.deepEqual(
      [...colours],
      [
        ['fs-grund', '#eff0ed'],
        ['fs-glut', '#a24c18'],
      ]
    )
  })
})

describe('compareColours', () => {
  const source = '$fs-a: #111111;\n$fs-b: #222222;\n'

  it('agrees when the values are the same, whatever the case and the rest of the file', () => {
    assert.deepEqual(
      compareColours(
        source,
        '// other comment\n$fs-b: #222222;\n$fs-a: #111111;\n$fs-mono: monospace;\n'
      ),
      []
    )
    assert.deepEqual(
      compareColours('$fs-a: #ABCDEF;\n', '$fs-a: #abcdef;\n'),
      []
    )
  })

  it('names a value that differs, one missing from the copy and one that is not in the source', () => {
    assert.deepEqual(
      compareColours(source, '$fs-a: #999999;\n$fs-c: #333333;\n'),
      [
        '$fs-a is #999999 in the copy and #111111 in the source',
        '$fs-b is in the source (#222222) and not in the copy',
        '$fs-c is in the copy (#333333) and not in the source',
      ]
    )
  })

  it('fails on a source without colours', () => {
    assert.ok(compareColours('nothing here', '$fs-a: #111111;').length > 0)
  })
})

describe('app/styles/_firestrike.scss', () => {
  it('holds colour variables', () => {
    const copy = readFileSync(
      Path.join(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        'app',
        'styles',
        '_firestrike.scss'
      ),
      'utf8'
    )

    assert.ok(parseColours(copy).size > 10)
  })
})
