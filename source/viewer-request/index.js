import crypto from "crypto";
import cf from "cloudfront";

/**
@typedef {{ value: string }} Value;
@typedef {{ uri: string; querystring: NodeJS.Dict<Value & Partial<{ multiValue: Value[] }>> }} Request;
@typedef {{
  request: Request;
  context: { requestId: string };
}} LambdaEvent
@typedef {{
  statusCode: number;
  body?: { data: string; encoding?: "text" | "base64" };
}} RequestViewerResponse
 */

/*
const secretManagerClient = new SecretsManagerClient();
let secretCache: NodeJS.Dict<string> | undefined;
*/

const kvsHandle = cf.kvs(KVS_ID);

/*
async function getSecret() {
  if (!secretCache) {
    const response = await secretManagerClient.send(
      new GetSecretValueCommand({
        SecretId: `${NODE_ENV === "development" ? "dev" : "prod"}/phx/app-settings`,
      })
    );
    if (response.SecretString) {
      secretCache = JSON.parse(response.SecretString);
    }
  }
  return secretCache?.hmacSecret;
}
*/

/**
 *
 * @param {LambdaEvent} event
 * @returns {Promise<RequestViewerResponse | Request>}
 */
async function handler(event) {
  console.log("Received event: " + JSON.stringify(event, null, 2));
  const request = event.request;

  if (/favicon\.ico$/gi.test(request.uri)) {
    return {
      statusCode: 404,
    };
  }
  try {
    if (!request.querystring.signature) {
      return {
        statusCode: 401, // unauthorized
        body: { data: "Missing signature", encoding: "text" },
      };
    }

    // verify signature matches so we know it's generated from us
    const secretKey = await kvsHandle.get("hmacSecret");
    const hash = crypto.createHmac("sha256", secretKey).update(request.uri).digest("hex");

    if (hash !== request.querystring.signature.value) {
      return {
        statusCode: 403,
        body: { data: "Invalid signature", encoding: "text" },
      };
    }

    return request;
  } catch (e) {
    console.error(e);
    return {
      statusCode: 400,
      body: {
        encoding: "text",
        data:
          NODE_ENV === "development"
            ? e.message
            : `An error occured, please contact us to resolve this issue. Reference #${event.context.requestId}`,
      },
    };
  }
}
