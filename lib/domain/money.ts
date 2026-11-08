export function minorToDecimal(value: string | bigint): string {
  const minor = BigInt(value);
  if (minor < 0n) throw new Error("Negative money is unsupported");
  return `${minor / 100n}.${(minor % 100n).toString().padStart(2, "0")}`;
}
export function decimalToMinor(value: string): string {
  if (!/^\d+\.\d{2}$/.test(value)) throw new Error("Invalid provider decimal");
  const [whole, fraction] = value.split(".");
  return (BigInt(whole) * 100n + BigInt(fraction)).toString();
}
export function usd(value: string | bigint): string {
  return `$${minorToDecimal(value)}`;
}
