import assert from 'node:assert'
import { describe, it } from 'node:test'
import * as React from 'react'

import '../../helpers/ui/xterm-globals'
import { render, waitFor } from '../../helpers/ui/render'
import { Terminal } from '../../../src/ui/terminal'

/** The text of the terminal's buffer, line by line, without trailing blanks. */
function bufferLines(terminal: Terminal) {
  const buffer = terminal.Terminal?.buffer.active
  const lines = new Array<string>()

  for (let i = 0; i < (buffer?.length ?? 0); i++) {
    lines.push(buffer?.getLine(i)?.translateToString(true) ?? '')
  }

  return lines.filter(l => l !== '')
}

describe('Terminal', () => {
  it('opens an xterm and shows the output it was given', async () => {
    const ref = React.createRef<Terminal>()
    const { container } = render(
      <Terminal
        ref={ref}
        terminalOutput={[
          Buffer.from('first line\n'),
          Buffer.from('second line\n'),
        ]}
      />
    )

    assert.ok(container.querySelector('.xterm'), 'the xterm is in the page')
    await waitFor(() =>
      assert.deepEqual(bufferLines(ref.current!), ['first line', 'second line'])
    )
  })

  it('converts line ends, so output with bare \\n starts at the left edge', async () => {
    const ref = React.createRef<Terminal>()
    render(<Terminal ref={ref} terminalOutput={'a\nb'} />)

    await waitFor(() => assert.deepEqual(bufferLines(ref.current!), ['a', 'b']))
  })

  it('takes the size from its props, 80 by 20 by default', () => {
    const ref = React.createRef<Terminal>()
    render(<Terminal ref={ref} />)
    assert.equal(ref.current?.Terminal?.cols, 80)
    assert.equal(ref.current?.Terminal?.rows, 20)

    const small = React.createRef<Terminal>()
    render(<Terminal ref={small} cols={40} rows={5} />)
    assert.equal(small.current?.Terminal?.cols, 40)
    assert.equal(small.current?.Terminal?.rows, 5)
  })

  it('writes output that arrives later', async () => {
    const ref = React.createRef<Terminal>()
    render(<Terminal ref={ref} terminalOutput={'one\n'} />)
    ref.current?.write([Buffer.from('two\n'), Buffer.from('three\n')])

    await waitFor(() =>
      assert.deepEqual(bufferLines(ref.current!), ['one', 'two', 'three'])
    )
  })

  it('does not take the tab key, so tab navigation of the app keeps working', () => {
    const ref = React.createRef<Terminal>()
    const { container } = render(<Terminal ref={ref} />)
    const textarea = container.querySelector('textarea')!

    const tab = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    })
    textarea.dispatchEvent(tab)

    assert.equal(tab.defaultPrevented, false)
  })

  it('takes the terminal out of the page when it is unmounted', () => {
    const { container, unmount } = render(<Terminal />)
    assert.ok(container.querySelector('.xterm'))

    unmount()
    assert.equal(container.querySelector('.xterm'), null)
  })
})
