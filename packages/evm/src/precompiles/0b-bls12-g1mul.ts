import { short } from '@ethereumjs/util'

import { EvmErrorResult, OOGResult } from '../evm'
import { ERROR, EvmError } from '../exceptions'

import type { ExecResult } from '../evm'
import type { PrecompileInput } from './types'

const {
  BLS12_381_ToG1Point,
  BLS12_381_FromG1Point,
  BLS12_381_ToFrPoint,
} = require('./util/bls12_381')

export async function precompile0b(opts: PrecompileInput): Promise<ExecResult> {
  const mcl = (<any>opts._EVM)._mcl!

  const inputData = opts.data

  // note: the gas used is constant; even if the input is incorrect.
  const gasUsed = opts._common.paramByEIP('gasPrices', 'Bls12381G1MulGas', 2537) ?? BigInt(0)
  if (opts._debug) {
    opts._debug(
      `Run BLS12G1MUL (0x0b) precompile data=${short(opts.data)} length=${
        opts.data.length
      } gasLimit=${opts.gasLimit} gasUsed=${gasUsed}`
    )
  }

  if (opts.gasLimit < gasUsed) {
    if (opts._debug) {
      opts._debug(`BLS12G1MUL (0x0b) failed: OOG`)
    }
    return OOGResult(opts.gasLimit)
  }

  if (inputData.length !== 160) {
    if (opts._debug) {
      opts._debug(`BLS12G1MUL (0x0b) failed: Invalid input length length=${inputData.length}`)
    }
    return EvmErrorResult(new EvmError(ERROR.BLS_12_381_INVALID_INPUT_LENGTH), opts.gasLimit)
  }

  // check if some parts of input are zero bytes.
  const zeroBytes16 = Buffer.alloc(16, 0)
  const zeroByteCheck = [
    [0, 16],
    [64, 80],
  ]

  for (const index in zeroByteCheck) {
    const slicedBuffer = opts.data.slice(zeroByteCheck[index][0], zeroByteCheck[index][1])
    if (!slicedBuffer.equals(zeroBytes16)) {
      if (opts._debug) {
        opts._debug(`BLS12G1MUL (0x0b) failed: Point not on curve`)
      }
      return EvmErrorResult(new EvmError(ERROR.BLS_12_381_POINT_NOT_ON_CURVE), opts.gasLimit)
    }
  }

  // convert input to mcl G1 points, add them, and convert the output to a Buffer.

  let mclPoint
  try {
    mclPoint = BLS12_381_ToG1Point(opts.data.slice(0, 128), mcl)
  } catch (e: any) {
    if (opts._debug) {
      opts._debug(`BLS12G1MUL (0x0b) failed: ${e.message}`)
    }
    return EvmErrorResult(e, opts.gasLimit)
  }

  const frPoint = BLS12_381_ToFrPoint(opts.data.slice(128, 160), mcl)

  const result = mcl.mul(mclPoint, frPoint)

  const returnValue = BLS12_381_FromG1Point(result)

  if (opts._debug) {
    opts._debug(`BLS12G1MUL (0x0b) return value=${returnValue.toString('hex')}`)
  }

  return {
    executionGasUsed: gasUsed,
    returnValue,
  }
}
