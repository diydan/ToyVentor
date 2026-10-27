import { describe, expect, it } from "vitest";
import { dimensionsFromBox, largestBox, parseSegmentationBoxes } from "../shared/sam";

// Real line prefixes captured from live sam-3.1 calls on 2026-10-27
// (cup + water bottle test image, 1920x1280). Mask payloads truncated;
// the parser only reads box tokens, exactly as production does today.
const CUP =
  "<0f>0<|box;x1=347;y1=734;x2=837;y2=1104;w=1920;h=1280|><|mask;x=0;y=0;data=371,491,!!!!%P@^|>";
const BOTTLE =
  "<0f>0<|box;x1=1161;y1=139;x2=1463;y2=1105;w=1920;h=1280|><|mask;x=0;y=0;data=967,303,!!!!%YB/|>";

describe("parseSegmentationBoxes", () => {
  it("parses the live cup box", () => {
    const [box] = parseSegmentationBoxes(CUP);
    expect(box).toMatchObject({
      objectId: 0, x1: 347, y1: 734, x2: 837, y2: 1104,
      imageWidth: 1920, imageHeight: 1280,
    });
  });

  it("parses the live bottle box", () => {
    const [box] = parseSegmentationBoxes(BOTTLE);
    expect(box).toMatchObject({ x1: 1161, y1: 139, x2: 1463, y2: 1105 });
  });

  it("empty lane means zero matches, not an error", () => {
    expect(parseSegmentationBoxes("")).toEqual([]);
    expect(largestBox([])).toBeUndefined();
  });

  it("handles several records and a confidence field", () => {
    const line =
      "<0f>0<|box;x1=0;y1=0;x2=10;y2=10;w=100;h=100|><|mask;x=0;y=0;data=11,11,!x|>,2<|box;x1=20;y1=20;x2=90;y2=80;w=100;h=100;c=0.96|><|mask;x=0;y=0;c=0.96;data=61,71,!x|>";
    const boxes = parseSegmentationBoxes(line);
    expect(boxes).toHaveLength(2);
    expect(boxes[1]?.confidence).toBeCloseTo(0.96);
    expect(largestBox(boxes)?.objectId).toBe(2);
  });
});

describe("dimensionsFromBox", () => {
  it("derives bottle width from a height anchor", () => {
    const [box] = parseSegmentationBoxes(BOTTLE);
    // 500ml bottle is about 210mm tall; box is 302x966 px.
    const dims = dimensionsFromBox(box!, 210);
    expect(dims.lengthMm).toBe(210);
    expect(dims.widthMm).toBe(66); // 210 * 302/966, a believable diameter
  });

  it("keeps the longest side as the length for a wide box", () => {
    const [box] = parseSegmentationBoxes(CUP);
    const dims = dimensionsFromBox(box!, 120);
    expect(dims).toEqual({ lengthMm: 120, widthMm: 120 });
  });
});
