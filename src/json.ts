/* eslint-disable anti-slop/no-object-parameters, anti-slop/no-runtime-typeof -- This serializer is the JSON boundary for raw TL objects, Long values, and byte arrays. */
import Long from "long";

type Serializable =
  | object
  | string
  | number
  | boolean
  | bigint
  | null
  | undefined;

export const json = (value: Serializable): string =>
  JSON.stringify(value, (_key: string, item: Serializable): Serializable => {
    if (Long.isLong(item) || typeof item === "bigint") {
      return item.toString();
    }
    if (item instanceof Uint8Array) {
      return { base64: Buffer.from(item).toString("base64") };
    }
    return item;
  });
