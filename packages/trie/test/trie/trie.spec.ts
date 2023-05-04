import { KECCAK256_RLP, bytesToHex, equalsBytes, utf8ToBytes } from '@ethereumjs/util'
import { keccak256 } from 'ethereum-cryptography/keccak'
import * as tape from 'tape'

import { ROOT_DB_KEY as BASE_DB_KEY, MapDB, Trie } from '../../src'

for (const { constructor, defaults, title } of [
  {
    constructor: Trie,
    title: 'Trie',
  },
  {
    constructor: Trie,
    title: 'SecureTrie',
    defaults: {
      useKeyHashing: true,
    },
  },
]) {
  const IS_SECURE_TRIE = title === 'SecureTrie'

  let ROOT_DB_KEY: Uint8Array
  if (IS_SECURE_TRIE) {
    ROOT_DB_KEY = keccak256(BASE_DB_KEY)
  } else {
    ROOT_DB_KEY = BASE_DB_KEY
  }

  let EXPECTED_ROOTS: string
  if (IS_SECURE_TRIE) {
    EXPECTED_ROOTS = '8204723ce0fb452b130a282ecc727e07295c18cbd2c2eef33ba9eb9c7a9ded9b'
  } else {
    EXPECTED_ROOTS = '99650c730bbb99f6f58ce8b09bca2a8d90b36ac662e71bf81ec401ed23d199fb'
  }

  tape(`${title} (Persistence)`, function (t) {
    t.test(
      'creates an instance via the static constructor `create` function and defaults to `false` with a database',
      async function (st) {
        st.false(
          ((await constructor.create({ ...defaults, db: new MapDB() })) as any)._useRootPersistence
        )

        st.end()
      }
    )

    t.test(
      'creates an instance via the static constructor `create` function and respects the `useRootPersistence` option with a database',
      async function (st) {
        st.false(
          (
            (await constructor.create({
              ...defaults,
              db: new MapDB(),
              useRootPersistence: false,
            })) as any
          )._useRootPersistence
        )

        st.end()
      }
    )

    t.test(
      'creates an instance via the static constructor `create` function and respects the `useRootPersistence` option with a database',
      async function (st) {
        st.false(
          (
            (await constructor.create({
              ...defaults,
              db: new MapDB(),
              useRootPersistence: false,
            })) as any
          )._useRootPersistence
        )

        st.end()
      }
    )

    t.test(
      'creates an instance via the static constructor `create` function and defaults to `false` without a database',
      async function (st) {
        st.false(
          ((await constructor.create({ ...defaults, db: new MapDB() })) as any)._useRootPersistence
        )

        st.end()
      }
    )

    t.test('persist the root if the `useRootPersistence` option is `true`', async function (st) {
      const trie = await constructor.create({
        ...defaults,
        db: new MapDB(),
        useRootPersistence: true,
      })

      // @ts-expect-error
      st.equal(await trie._db.get(ROOT_DB_KEY), undefined)

      await trie.put(utf8ToBytes('foo'), utf8ToBytes('bar'))

      // @ts-expect-error
      st.equal(bytesToHex(await trie._db.get(ROOT_DB_KEY)), EXPECTED_ROOTS)

      st.end()
    })

    t.test('persist the root if the `root` option is given', async function (st) {
      const trie = await constructor.create({
        ...defaults,
        db: new MapDB(),
        root: KECCAK256_RLP,
        useRootPersistence: true,
      })

      // @ts-expect-error
      st.ok(equalsBytes((await trie._db.get(ROOT_DB_KEY))!, KECCAK256_RLP))

      await trie.put(utf8ToBytes('foo'), utf8ToBytes('bar'))

      // @ts-expect-error
      st.false(equalsBytes((await trie._db.get(ROOT_DB_KEY))!, KECCAK256_RLP))

      st.end()
    })

    t.test(
      'does not persist the root if the `useRootPersistence` option is `false`',
      async function (st) {
        const trie = await constructor.create({
          ...defaults,
          db: new MapDB(),
          useRootPersistence: false,
        })

        // @ts-expect-error
        st.equal(await trie._db.get(ROOT_DB_KEY), undefined)

        await trie.put(utf8ToBytes('do_not_persist_with_db'), utf8ToBytes('bar'))

        // @ts-expect-error
        st.equal(await trie._db.get(ROOT_DB_KEY), undefined)

        st.end()
      }
    )

    t.test('persists the root if the `db` option is not provided', async function (st) {
      const trie = await constructor.create({ ...defaults, useRootPersistence: true })

      // @ts-expect-error
      st.equal(await trie._db.get(ROOT_DB_KEY), undefined)

      await trie.put(utf8ToBytes('do_not_persist_without_db'), utf8ToBytes('bar'))

      // @ts-expect-error
      st.notEqual(await trie._db.get(ROOT_DB_KEY), undefined)

      st.end()
    })

    t.test('persist and restore the root', async function (st) {
      const db = new MapDB()

      const trie = await constructor.create({ ...defaults, db, useRootPersistence: true })
      // @ts-expect-error
      st.equal(await trie._db.get(ROOT_DB_KEY), undefined)
      await trie.put(utf8ToBytes('foo'), utf8ToBytes('bar'))
      // @ts-expect-error
      st.equal(bytesToHex(await trie._db.get(ROOT_DB_KEY)), EXPECTED_ROOTS)

      // Using the same database as `trie` so we should have restored the root
      const copy = await constructor.create({ ...defaults, db, useRootPersistence: true })
      // @ts-expect-error
      st.equal(bytesToHex(await copy._db.get(ROOT_DB_KEY)), EXPECTED_ROOTS)

      // New trie with a new database so we shouldn't find a root to restore
      const empty = await constructor.create({
        ...defaults,
        db: new MapDB(),
        useRootPersistence: true,
      })
      // @ts-expect-error
      st.equal(await empty._db.get(ROOT_DB_KEY), undefined)

      st.end()
    })

    t.test('put fails if the key is the ROOT_DB_KEY', async function (st) {
      const trie = new constructor({ ...defaults, db: new MapDB(), useRootPersistence: true })

      try {
        await trie.put(BASE_DB_KEY, utf8ToBytes('bar'))
        st.fail("Attempting to set '__root__' should fail but it did not.")
      } catch ({ message }: any) {
        st.equal(message, "Attempted to set '__root__' key but it is not allowed.")
      }

      st.end()
    })

    t.end()
  })
}
