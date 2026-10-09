import { jsx as _jsx } from "react/jsx-runtime";
import { BrandWordmark, FishLogo } from '@deepseek-ai/dsh-client-ui-primitives';
/**
 * Render the official mark with the presentation requested by its host surface.
 * @param props - Host-supplied mark presentation.
 * @returns the official whale mark.
 */
export function OfficialBrandMark({ size, className }) {
    return _jsx(FishLogo, { size: size, className: className });
}
/**
 * Render the official name artwork without its independently slotted mark.
 * @returns the official name wordmark.
 */
export function OfficialBrandName() {
    return _jsx(BrandWordmark, { includeMark: false });
}
