import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  describeFindings,
  findRepositoryFindings,
  fingerprintFindings,
  getOverrideArguments,
  getTransportBlockKeys,
  hasFindings,
  IConfigEntry,
  isCommandKey,
  isTransportKey,
  makeVisible,
  parseConfigList,
} from '../../../src/lib/git/repository-trust'

const entry = (key: string, value = 'x', scope = 'local'): IConfigEntry => ({
  scope,
  origin: 'file:.git/config',
  key,
  value,
})

describe('parseConfigList', () => {
  it('reads scope, origin, key and value, with newlines in a value', () => {
    const text = [
      'local\0file:.git/config\0core.editor\nvim -c "a\nb"\0',
      'global\0file:/home/u/.gitconfig\0user.name\nT\0',
      'local\0file:.git/config\0core.bare\0',
    ].join('')

    assert.deepEqual(parseConfigList(text), [
      {
        scope: 'local',
        origin: 'file:.git/config',
        key: 'core.editor',
        value: 'vim -c "a\nb"',
      },
      {
        scope: 'global',
        origin: 'file:/home/u/.gitconfig',
        key: 'user.name',
        value: 'T',
      },
      {
        scope: 'local',
        origin: 'file:.git/config',
        key: 'core.bare',
        value: 'true',
      },
    ])
  })

  it('reads nothing from nothing', () => {
    assert.deepEqual(parseConfigList(''), [])
  })
})

describe('which keys run programs', () => {
  const commands = [
    'core.sshCommand',
    'core.askPass',
    'core.gitProxy',
    'core.hooksPath',
    'core.pager',
    'core.editor',
    'pager.log',
    'sequence.editor',
    'diff.external',
    'diff.evil.textconv',
    'diff.evil.command',
    'merge.evil.driver',
    'filter.evil.clean',
    'filter.evil.smudge',
    'filter.evil.process',
    'credential.helper',
    'credential.https://example.com.helper',
    'gpg.program',
    'gpg.x509.program',
    'gpg.ssh.program',
    'gpg.ssh.defaultKeyCommand',
    'remote.origin.uploadpack',
    'remote.origin.receivepack',
    'CORE.SSHCOMMAND',
  ]

  for (const key of commands) {
    it(`${key} does`, () => assert.equal(isCommandKey(entry(key)), true))
  }

  it('core.fsmonitor does unless it is one of Git’s own switches', () => {
    assert.equal(isCommandKey(entry('core.fsmonitor', 'touch /x')), true)
    assert.equal(
      isCommandKey(entry('core.fsmonitor', '.git/hooks/fsmonitor-watchman')),
      true
    )
    for (const v of ['true', 'false', 'TRUE', '1', '0', 'yes', 'no']) {
      assert.equal(isCommandKey(entry('core.fsmonitor', v)), false, v)
    }
  })

  it('a submodule update does when it is a !command', () => {
    assert.equal(isCommandKey(entry('submodule.x.update', '!touch /x')), true)
    assert.equal(isCommandKey(entry('submodule.x.update', 'checkout')), false)
  })

  it('ordinary keys do not', () => {
    for (const key of [
      'user.name',
      'core.autocrlf',
      'remote.origin.url',
      'remote.origin.fetch',
      'branch.main.remote',
      'diff.algorithm',
      'filter.lfs.required',
      'core.filemode',
    ]) {
      assert.equal(isCommandKey(entry(key)), false, key)
      assert.equal(isTransportKey(entry(key)), false, key)
    }
  })
})

describe('which keys change the transport', () => {
  for (const key of [
    'http.sslVerify',
    'http.sslCAInfo',
    'http.sslCAPath',
    'http.proxy',
    'http.https://example.com.sslVerify',
    'http.https://example.com.proxy',
    'url.https://evil.example/.insteadOf',
    'url.https://evil.example/.pushInsteadOf',
    'http.cookieFile',
    'http.saveCookies',
  ]) {
    it(`${key} does`, () => assert.equal(isTransportKey(entry(key)), true))
  }
})

describe('findRepositoryFindings', () => {
  it('looks at the repository’s own scopes only', () => {
    const findings = findRepositoryFindings(
      [
        entry('core.sshCommand', 'ssh -i x', 'global'),
        entry('core.sshCommand', 'touch /x', 'local'),
        entry('filter.evil.clean', 'cat', 'worktree'),
        entry('http.proxy', 'http://p', 'system'),
      ],
      []
    )

    assert.deepEqual(
      findings.commandEntries.map(e => e.key),
      ['core.sshCommand', 'filter.evil.clean']
    )
    assert.deepEqual(findings.transportEntries, [])
  })

  it('counts every hook that does not end in .sample, executable or not', () => {
    const findings = findRepositoryFindings(
      [],
      [
        { name: 'pre-commit.sample', sha256: 'a' },
        { name: 'pre-commit', sha256: 'b' },
        { name: 'post-checkout.bat', sha256: 'c' },
      ]
    )

    assert.deepEqual(
      findings.hooks.map(h => h.name),
      ['pre-commit', 'post-checkout.bat']
    )
    assert.equal(hasFindings(findings), true)
  })

  it('has nothing for a repository that sets nothing', () => {
    const findings = findRepositoryFindings(
      [entry('user.name'), entry('core.filemode', 'true')],
      [{ name: 'pre-push.sample', sha256: 'a' }]
    )
    assert.equal(hasFindings(findings), false)
  })

  it('says when the hooks path or an included file lies in the work tree', () => {
    const findings = findRepositoryFindings(
      [
        entry('core.hooksPath', '/work/hooks'),
        {
          scope: 'local',
          origin: 'file:/work/extra.cfg',
          key: 'user.x',
          value: '1',
        },
        {
          scope: 'local',
          origin: 'file:/etc/shared.cfg',
          key: 'user.y',
          value: '1',
        },
      ],
      [],
      p => p.startsWith('/work/')
    )

    assert.equal(findings.hooksPathInWorkTree, true)
    assert.deepEqual(findings.includesInWorkTree, ['/work/extra.cfg'])
  })
})

describe('fingerprintFindings', () => {
  const base = () =>
    findRepositoryFindings(
      [entry('core.sshCommand', 'ssh -i k'), entry('http.proxy', 'http://p')],
      [{ name: 'pre-commit', sha256: 'aa' }]
    )

  it('is the same for the same findings, whatever their order', () => {
    const a = base()
    const b = findRepositoryFindings(
      [entry('http.proxy', 'http://p'), entry('core.sshCommand', 'ssh -i k')],
      [{ name: 'pre-commit', sha256: 'aa' }]
    )
    assert.equal(fingerprintFindings(a), fingerprintFindings(b))
  })

  it('changes with a value, a key, an origin, a hook name or a hook’s content', () => {
    const f = fingerprintFindings(base())
    const variants = [
      findRepositoryFindings(
        [
          entry('core.sshCommand', 'ssh -i other'),
          entry('http.proxy', 'http://p'),
        ],
        [{ name: 'pre-commit', sha256: 'aa' }]
      ),
      findRepositoryFindings(
        [
          entry('core.sshCommand', 'ssh -i k'),
          entry('http.proxy', 'http://p', 'worktree'),
        ],
        [{ name: 'pre-commit', sha256: 'aa' }]
      ),
      findRepositoryFindings(
        [
          {
            ...entry('core.sshCommand', 'ssh -i k'),
            origin: 'file:/work/x.cfg',
          },
          entry('http.proxy', 'http://p'),
        ],
        [{ name: 'pre-commit', sha256: 'aa' }]
      ),
      findRepositoryFindings(
        [entry('core.sshCommand', 'ssh -i k'), entry('http.proxy', 'http://p')],
        [{ name: 'pre-push', sha256: 'aa' }]
      ),
      findRepositoryFindings(
        [entry('core.sshCommand', 'ssh -i k'), entry('http.proxy', 'http://p')],
        [{ name: 'pre-commit', sha256: 'bb' }]
      ),
      findRepositoryFindings(
        [entry('core.sshCommand', 'ssh -i k')],
        [{ name: 'pre-commit', sha256: 'aa' }]
      ),
    ]

    for (const v of variants) {
      assert.notEqual(fingerprintFindings(v), f)
    }
  })
})

describe('getOverrideArguments', () => {
  it('names every command key found, and always the hooks and the file system monitor', () => {
    const findings = findRepositoryFindings(
      [
        entry('core.sshCommand', 'touch /x'),
        entry('filter.evil.clean', 'touch /x'),
        entry('remote.origin.uploadpack', 'touch /x'),
        entry('credential.https://h.helper', 'store'),
      ],
      []
    )

    const args = getOverrideArguments(findings, '/empty')
    const pairs = args.filter((_, i) => i % 2 === 1)

    assert.ok(args.filter((_, i) => i % 2 === 0).every(a => a === '-c'))
    assert.ok(pairs.includes('core.sshCommand=ssh'))
    assert.ok(pairs.includes('filter.evil.clean=cat'))
    assert.ok(pairs.includes('remote.origin.uploadpack=git-upload-pack'))
    assert.ok(pairs.includes('credential.https://h.helper='))
    assert.ok(pairs.includes('core.hooksPath=/empty'))
    assert.ok(pairs.includes('core.fsmonitor=false'))
  })

  it('names the hooks and the monitor even for a repository that sets neither', () => {
    const args = getOverrideArguments(findRepositoryFindings([], []), '/empty')
    assert.deepEqual(args, [
      '-c',
      'core.hooksPath=/empty',
      '-c',
      'core.fsmonitor=false',
      '-c',
      'submodule.recurse=false',
    ])
  })

  it('neutralises core.alternateRefsCommand and treats protocol.* as a transport key', () => {
    const entries = [
      {
        scope: 'local',
        origin: 'file:c',
        key: 'core.alternaterefscommand',
        value: 'evil',
      },
      {
        scope: 'local',
        origin: 'file:c',
        key: 'protocol.ext.allow',
        value: 'always',
      },
    ]
    const findings = findRepositoryFindings(entries, [])
    assert.ok(
      getOverrideArguments(findings, '/e').includes(
        'core.alternaterefscommand=true'
      )
    )
    assert.deepEqual(getTransportBlockKeys(findings), ['protocol.ext.allow'])
  })
})

describe('getTransportBlockKeys', () => {
  it('lists each key once, as written', () => {
    const findings = findRepositoryFindings(
      [
        entry('http.proxy', 'a'),
        entry('http.proxy', 'b'),
        entry('http.sslVerify', 'false'),
      ],
      []
    )
    assert.deepEqual(getTransportBlockKeys(findings), [
      'http.proxy',
      'http.sslVerify',
    ])
  })
})

describe('makeVisible and describeFindings', () => {
  it('shows control, direction and zero-width characters as code points', () => {
    const text = [
      'a',
      String.fromCharCode(0x1b),
      'b',
      String.fromCharCode(0x202e),
      'c',
      String.fromCharCode(0x200b),
      String.fromCharCode(0x2066),
      String.fromCharCode(0xfeff),
      String.fromCharCode(0x61c),
      '\n',
    ].join('')

    assert.equal(
      makeVisible(text),
      'a[U+001B]b[U+202E]c[U+200B][U+2066][U+FEFF][U+061C][U+000A]'
    )
  })

  it('leaves ordinary text, including umlauts and emoji, alone', () => {
    assert.equal(
      makeVisible('Prüfung ß 中文 \u{1F41E}'),
      'Prüfung ß 中文 \u{1F41E}'
    )
  })

  it('describes keys, values and hooks as text with the controls visible', () => {
    const findings = findRepositoryFindings(
      [entry('core.sshCommand', `ssh${String.fromCharCode(0x202e)}`)],
      [{ name: 'pre-commit', sha256: 'a' }]
    )
    assert.deepEqual(describeFindings(findings), [
      'core.sshCommand = ssh[U+202E]',
      'hook: pre-commit',
    ])
  })
})
