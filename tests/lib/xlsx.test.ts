import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { columnIndex, decodeXmlEntities, parseSharedStrings, parseSheetXml, readXlsx } from "@/lib/xlsx";
import { buildWorkbook, buildZip } from "../helpers/xlsxFixture";

const sheetXml = `<?xml version="1.0"?><worksheet><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="E1"><v>10000</v></c></row>
<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" s="3"><v>46296</v></c><c r="C2"><v>100</v></c><c r="E2"><f>E1-C2</f><v>9900</v></c></row>
<row r="4"><c r="A4" t="inlineStr"><is><t>Inline &amp; text</t></is></c><c r="F4" t="str"><v>AD</v></c><c r="G4" t="b"><v>1</v></c><c r="H4" t="e"><v>#REF!</v></c><c r="I4" s="2"/></row>
</sheetData></worksheet>`;

describe("readXlsx", () => {
  it("reads sheets in workbook order with shared strings, numbers, and formulas' cached values", async () => {
    const book = buildWorkbook(
      [
        { name: "Sep 26", xml: sheetXml },
        { name: "Oct 26", xml: sheetXml, hidden: true },
      ],
      ["", "DATE", "Weekly Spend"]
    );
    const sheets = await readXlsx(book);
    expect(sheets.map((s) => [s.name, s.hidden])).toEqual([
      ["Sep 26", false],
      ["Oct 26", true],
    ]);
    const rows = sheets[0].rows;
    expect(rows[0]).toEqual(["", "DATE", null, null, 10000]);
    expect(rows[1]).toEqual(["Weekly Spend", 46296, 100, null, 9900]);
    expect(rows[2]).toEqual([]); // the missing row 3
    expect(rows[3]).toEqual(["Inline & text", null, null, null, null, "AD", true, null, null]);
  });

  it("uses the platform's DecompressionStream by default and accepts an injected inflater", async () => {
    const book = buildWorkbook([{ name: "S", xml: sheetXml }], ["", "DATE", "Weekly Spend"]);
    const viaStream = await readXlsx(book);
    const viaZlib = await readXlsx(book, async (d) => new Uint8Array(inflateRawSync(d)));
    expect(viaZlib).toEqual(viaStream);
  });

  it("reads stored (uncompressed) entries", async () => {
    const files = {
      "xl/workbook.xml": '<workbook><sheets><sheet name="A" sheetId="1" r:id="rId1"/></sheets></workbook>',
      "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Target="/xl/worksheets/a.xml"/></Relationships>',
      "xl/worksheets/a.xml": '<worksheet><sheetData><row r="1"><c r="B1"><v>1.5</v></c></row></sheetData></worksheet>',
    };
    const sheets = await readXlsx(buildZip(files, false));
    expect(sheets[0].rows).toEqual([[null, 1.5]]);
  });

  it("rejects something that isn't a zip", async () => {
    await expect(readXlsx(new TextEncoder().encode("Date,Amount\n1,2"))).rejects.toThrow(/Not an \.xlsx/);
  });

  it("rejects a zip without a workbook", async () => {
    await expect(readXlsx(buildZip({ "hello.txt": "hi" }))).rejects.toThrow(/workbook/);
  });
});

describe("xlsx XML helpers", () => {
  it("maps column letters to indexes", () => {
    expect(columnIndex("A1")).toBe(0);
    expect(columnIndex("L1")).toBe(11);
    expect(columnIndex("Z9")).toBe(25);
    expect(columnIndex("AA10")).toBe(26);
  });

  it("joins rich-text runs and drops phonetic hints", () => {
    const xml = '<sst><si><r><t>152 </t></r><r><rPr/><t xml:space="preserve">Rent</t></r><rPh><t>x</t></rPh></si><si><t/></si></sst>';
    expect(parseSharedStrings(xml)).toEqual(["152 Rent", ""]);
  });

  it("decodes entities", () => {
    expect(decodeXmlEntities("A &amp; B &lt;C&gt; &quot;d&quot; &apos;e&apos; &#36;5 &#x41;")).toBe(`A & B <C> "d" 'e' $5 A`);
  });

  it("places cells without an r attribute after the previous one", () => {
    expect(parseSheetXml("<row><c><v>1</v></c><c><v>2</v></c></row>", [])).toEqual([[1, 2]]);
  });
});
