import { handlers } from './opcodes'

// Constants
const MAGIC = Buffer.from('EF00', 'hex')

const KIND_TYPE = 1
const KIND_CODE = 2
const KIND_DATA = 3
const TERMINATOR = 0

/**
 * Checks if the `code` is of EOF format
 * @param code Code to check
 * @returns
 */
export const isEOFCode = (code: Buffer): boolean => {
  return code.slice(0, 2).equals(MAGIC)
}

/**
 * Returns the EOF version number
 * Note: should only be called if the code is EOF code
 * Note: if `0` is returned, this is EOF0, so legacy code
 * @param code Code to check
 */
export const getEOFVersion = (code: Buffer): number => {
  if (!isEOFCode(code)) {
    return 0
  }
  return _getEOFVersion(code)
}

// Internal version of the get EOF version logic
function _getEOFVersion(code: Buffer) {
  return code[2]
}

/**
 * This method checks if `code` is valid EOF code
 * Note: if the code is a legacy contract, this returns true
 * This method should only be called if EIP 3540 (EOF v1) is activated
 * @param code Code to check
 */
export function validateCode(code: Buffer): boolean {
  // TODO: Is this not cleaner to throw if it is invalid? Then we can add error strings to it, why it is invalid EOF code (note: this also thus does a quick check if it is legacy code)
  if (!isEOFCode(code)) {
    // Legacy code
    return true
  }
  if (code.length <= 2) {
    // No version
    return false
  }
  const version = _getEOFVersion(code)
  if (version !== 0) {
    // Only version 1 is supported now
    return false
  }
  /**
   * EOF version 1
   */

  // Gotcha at this point: in EOF1, the header all has mandatory fields and therefore always looks the same at some byte indices

  // Ensure that at least the following fields are defined:
  // 0xEF000101 <type section size (2 bytes)> 02 <num code sections (2 bytes)>
  // This means that the header itself should have AT LEAST 9 bytes (but this header is still invalid, anyways, as it has no code sections and no data section)

  if (code.length < 15) {
    return false
  }

  // EF000101FFFF02FFFFEEEE03FFFF
  // 0 1 2 3 4 5 6 7 8 9 A B C D
  if (code[3] !== KIND_TYPE) {
    // 3rd byte is not type section kind
    return false
  }

  const typeSectionSize = code.readUint16BE(4)

  if (typeSectionSize % 4 !== 0) {
    // Type section size should be a multiple of 4
    return false
  }

  // Each type section
  if (typeSectionSize < 4) {
    // There is at least one code section so there also should be at least one type section
    return false
  }

  if (code[6] !== KIND_CODE) {
    // 6th byte is not code section kind
    return false
  }

  // Get the number of code sections
  const numCodeSections = code.readUint16BE(7)
  // Ensure that there are no more than 1024 code sections. There must be at least one code section
  if (numCodeSections > 1024 || numCodeSections === 0) {
    return false
  }

  // Verify that each code section has a type section
  if (typeSectionSize / 4 !== numCodeSections) {
    return false
  }

  // Ensure that header length is at least 7 + 2 + 2*numCodeSections (code_size_section now fits in)

  const dataSectionMarkerIndex = 9 + 2 * numCodeSections
  if (code.length < dataSectionMarkerIndex) {
    return false
  }

  if (code[dataSectionMarkerIndex] !== KIND_DATA) {
    // After the code section (dynamic length depending on `numCodeSections`) the KIND_DATA separator is expected, but is not there
    return false
  }

  // Next 2 bytes after dataSectionMarkerIndex is the data section size. After this, the terminator is expected
  // The length should be at least the dataSectionMarkerIndex + 1 (KIND_DATA) + 2 (data section size) + 1 (terminator)

  const bodyStartPos = dataSectionMarkerIndex + 4
  if (code.length < bodyStartPos) {
    return false
  }

  if (code[dataSectionMarkerIndex + 3] !== TERMINATOR) {
    // Terminator field not present
    return false
  }

  // At this point, EOF header is correct
  // Validate the body

  // Now validate the body

  const numTypeSections = typeSectionSize / 4
  let currentBodyPos = bodyStartPos
  for (let typeSection = 0; typeSection < numTypeSections; typeSection++) {
    const inputs = code.readUint8(currentBodyPos)
    if (inputs > 0x7f) {
      // Highest byte should be 0
      return false
    }
    const outputs = code.readUint8(currentBodyPos + 1)
    if (outputs > 0x7f) {
      // Highest byte should be 0
      return false
    }
    const maxStackHeight = code.readUint16BE(currentBodyPos + 2)
    if (maxStackHeight > 1023) {
      return false
    }
    currentBodyPos += 4
  }

  // Determine the size of the code
  let codeSize = 0

  for (let pos = 9; pos < 9 + 2 * numCodeSections; pos += 2) {
    codeSize += code.readUint16BE(pos)
  }

  const dataSectionSize = code.readUint16BE(dataSectionMarkerIndex + 1)

  currentBodyPos += codeSize + dataSectionSize

  if (currentBodyPos !== code.length - 1) {
    // The container is either too large or too small
    return false
  }

  // Verify opcodes
  if (!checkOpcodes(code)) {
    return false
  }

  return true
}

function checkOpcodes(code: Buffer) {
  // EIP-3670 - validate all opcodes
  const opcodes = new Set(handlers.keys())
  opcodes.add(0xfe) // Add INVALID opcode to set
  opcodes.delete(0x58) // Delete PC opcode from set (See EIP 4750)
  opcodes.delete(0xff) // Delete SELFDESTRUCT opcode from set (See EIP 3670)
  opcodes.delete(0xf2) // Delete CALLCODE opcode from set (See EIP 3670)

  const rjumpdests = new Set()
  const immediates = new Set()

  let pos = 0
  while (pos < code.length) {
    const opcode = code[pos]
    pos++
    if (!opcodes.has(opcode)) {
      // No invalid/undefined opcodes
      return false
    }
    if (opcode >= 0x60 && opcode <= 0x7f) {
      // Skip data block following PUSH* instruction
      const finalPos = pos + opcode - 0x5f
      for (let immediate = pos; immediate < finalPos; immediate++) {
        immediates.add(immediate)
      }
      pos = finalPos
      if (pos > code.length - 1) {
        // Push blocks must not exceed end of code section
        return false
      }
    }
    // RJUMP* checks
    if (opcode === 0x5c || opcode === 0x5d) {
      // RJUMP + RJUMPI
      immediates.add(pos)
      immediates.add(pos + 1)
      if (pos + 2 > code.length - 1) {
        // RJUMP(I) relative offset is out of code bounds
        return false
      }
      // RJUMP/RJUMPI
      const target = code.readInt16BE(pos) + pos + 2
      rjumpdests.add(target)
      if (target > code.length - 1 || target < 0) {
        // JUMP is out of bounds
        return false
      }
      pos += 2
    } else if (opcode === 0x5e) {
      // RJUMPV
      const tableSize = code[pos]
      if (tableSize === 0) {
        // cannot have table size 0
        return false
      }
      const jumptableSize = tableSize * 2
      if (pos + jumptableSize + 1 > code.length - 1) {
        // JUMP table is not contained in the code
        return false
      }
      const finalPos = pos + 1 + jumptableSize
      for (let immediate = pos; immediate < finalPos; immediate++) {
        immediates.add(immediate)
      }
      // Move pos to the start of the jump table
      pos++
      for (let jumptablePosition = pos; jumptablePosition < finalPos; jumptablePosition += 2) {
        const target = code.readInt16BE(jumptablePosition) + finalPos
        rjumpdests.add(target)
        if (target > code.length - 1 || target < 0) {
          // Relative JUMP is outside code container
          return false
        }
      }
      pos = finalPos
    }
  }
  const terminatingOpcodes = new Set([0x00, 0xf3, 0xfd, 0xfe, 0xff])
  // Per EIP-3670, the final opcode of a code section must be STOP, RETURN, REVERT, INVALID, or SELFDESTRUCT
  if (!terminatingOpcodes.has(code[code.length - 1])) {
    return false
  }
  // verify if any of the RJUMP* opcodes JUMPs into an immediate value
  for (const rjumpdest of rjumpdests) {
    if (immediates.has(rjumpdest)) {
      return false
    }
  }
  return true
}

// Deprecate below opcodes (this is breaking, but we should remove those)

/**
 *
 * @param container A `Buffer` containing bytecode to be checked for EOF1 compliance
 * @returns an object containing the size of the code section and data sections for a valid
 * EOF1 container or else undefined if `container` is not valid EOF1 bytecode
 *
 * Note: See https://eips.ethereum.org/EIPS/eip-3540 for further details
 */

/* TODO figure out how to be backwards compatible (I do not think this is possible)
export const codeAnalysis = (container: Buffer) => {
  throw new Error('removed in PR 2453')
}

export const validOpcodes = (code: Buffer, common?: Common) => {
  throw new Error('removed in PR 2453')
}

export const getEOFCode = (code: Buffer) => {
  throw new Error('removed in PR 2453')
}*/

export const EOF = { MAGIC }
