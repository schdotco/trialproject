const SHEET = "Sheet1";

function doPost(e) {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET);
  const d = JSON.parse(e.postData.contents);

  sh.appendRow([
    new Date(),
    d.ihNormal,
    d.ihRisti,
    d.bNormal,
    d.bStunting,
    d.bGizi,
    d.disabilitas,
    d.tbPengobatan,
    d.tbTotal,
    d.lMandiri,
    d.lB,
    d.lC,
    d.odf
  ]);

  return ContentService.createTextOutput("OK");
}

function doGet() {
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET);
  const data = sh.getDataRange().getValues();
  data.shift(); // hapus header
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
