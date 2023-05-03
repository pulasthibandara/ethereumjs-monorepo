import { RLP } from '@ethereumjs/rlp'

import { bytesToNibbles } from '..'

import { BranchNode, ExtensionNode, LeafNode } from './index'

import type { NodeType, TNode, TNodeOptions, TOpts } from '..'

type NodeFromOptions<T extends TNodeOptions<NodeType>> = T extends TNodeOptions<'LeafNode'>
  ? LeafNode
  : T extends TNodeOptions<'BranchNode'>
  ? BranchNode
  : T extends TNodeOptions<'ExtensionNode'>
  ? ExtensionNode
  : never

export class TrieNode {
  static async create<T extends TOpts>(options: T): Promise<NodeFromOptions<T>> {
    let node: NodeFromOptions<T>
    if ('key' in options && 'value' in options) {
      node = new LeafNode(options) as NodeFromOptions<T>
    } else if ('children' in options && 'value' in options) {
      node = new BranchNode(options) as NodeFromOptions<T>
    } else if ('keyNibbles' in options && 'subNode' in options) {
      node = new ExtensionNode(options) as NodeFromOptions<T>
    } else {
      throw new Error(`Unknown node type: ${Object.keys(options)}`)
    }
    return node
  }
  static async decode(encoded: Uint8Array): Promise<TNode> {
    {
      const raw = RLP.decode(encoded) as Uint8Array[]
      const type = TrieNode._type(encoded)
      switch (type) {
        case 'LeafNode': {
          const [key, value] = raw
          return TrieNode.create({ key: key as Uint8Array, value })
        }
        case 'BranchNode': {
          const children: (TNode | null)[] = []
          for (let i = 0; i < 16; i++) {
            const branch = raw[i]
            if (branch.length > 0) {
              const node = await TrieNode.decode(branch)
              children.push(node)
            } else {
              children.push(null)
            }
          }
          return TrieNode.create({
            children,
            value: raw.slice(-1)[0],
          })
        }
        case 'ExtensionNode': {
          const [key, subNodeRlp] = raw
          const subNode = await TrieNode.decode(subNodeRlp)
          return TrieNode.create({ keyNibbles: bytesToNibbles(key as Uint8Array), subNode })
        }
        default:
          throw new Error(`Unknown node type: ${type}`)
      }
    }
  }

  static _raw(encoded: Uint8Array): Uint8Array[] {
    return RLP.decode(encoded) as Uint8Array[]
  }
  static _type(encoded: Uint8Array): NodeType {
    const raw = TrieNode._raw(encoded)
    const type =
      raw.length === 17
        ? 'BranchNode'
        : raw.length === 2 && bytesToNibbles(encoded)[0] > 0
        ? 'LeafNode'
        : raw.length === 2
        ? 'ExtensionNode'
        : undefined
    if (!type) {
      throw new Error(`Unknown node type: ${type}`)
    }
    return type
  }
}
