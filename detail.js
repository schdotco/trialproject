const sheetId = "SPREADSHEET_ID_KAMU";
const apiKey = "GOOGLE_API_KEY";
const range = "Sheet1!A2:D";

fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?key=${apiKey}`)
  .then(res => res.json())
  .then(data => {
    const table = document.getElementById("dataTable");

    data.values.forEach(row => {
      table.innerHTML += `
        <tr>
          <td>${row[0]}</td>
          <td>${row[1]}</td>
          <td>${row[2]}</td>
          <td>${row[3]}</td>
        </tr>`;
    });
  });
