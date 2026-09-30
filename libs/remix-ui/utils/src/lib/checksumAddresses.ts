import { getAddress } from 'ethers'

export const checksumAddressesRaw = (value: any, input: any): any => {
  const type: string = input?.type || ''
  if (type === 'address' && typeof value === 'string') {
    try { return getAddress(value.toLowerCase()) } catch { return value }
  }
  if (type === 'address[]' && Array.isArray(value)) {
    return value.map((v: string) => { try { return getAddress(v.toLowerCase()) } catch { return v } })
  }
  if (type === 'tuple' && input?.components && typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const result: Record<string, any> = {}
    for (const comp of input.components) result[comp.name] = checksumAddressesRaw(value[comp.name], comp)
    return result
  }
  if (type === 'tuple[]' && input?.components && Array.isArray(value)) {
    return value.map((item: any) => {
      const result: Record<string, any> = {}
      for (const comp of input.components) result[comp.name] = checksumAddressesRaw(item[comp.name], comp)
      return result
    })
  }
  return value
}

export const checksumAddressesInValue = (value: any, input: any): string => {
  const result = checksumAddressesRaw(value, input)
  return typeof result === 'string' ? result : JSON.stringify(result)
}
