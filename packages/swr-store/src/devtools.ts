/**
 * @license
 * MIT License
 *
 * Copyright (c) 2021 Alexis Munsayac
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 *
 * @author Alexis Munsayac <alexis.munsayac@gmail.com>
 * @copyright Alexis Munsayac 2021
 */
function parseSafe<T>(obj: T) {
  const getCircularReplacer = () => {
    const seen = new WeakSet();
    return (_: string, value: unknown): any => {
      if (value instanceof Promise) {
        return '« Promise »';
      }
      if (value instanceof Map) {
        return Array.from(value);
      }
      if (value instanceof Set) {
        return Array.from(value);
      }
      if (typeof value === 'function') {
        return `ƒ ${value.name} () { }`;
      }
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '« recursive »';
        }
        seen.add(value);
      }
      return value;
    };
  };

  return JSON.stringify(obj, getCircularReplacer());
}

export default function updateData<T>(key: string, type: string, data: T): void {
  if (process.env.NODE_ENV !== 'production' && typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent('__SWR_STORE__', {
      detail: parseSafe({
        key,
        type,
        data,
      }),
    }));
  }
}