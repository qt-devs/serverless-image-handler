const crypto = require("crypto");

const encoded = Buffer.from(
  JSON.stringify({
    key: "img/12x18.jpg",
    edits: { resize: { width: 1000, height: 1000, fit: "inside" } },
  })
).toString("base64");
const secretKey = "*i_msu.LA@b9pWetxnHdrTAkC48oPF";
const hash = crypto.createHmac("sha256", secretKey).update(`/${encoded}`).digest("hex");

console.log(encoded, hash);
