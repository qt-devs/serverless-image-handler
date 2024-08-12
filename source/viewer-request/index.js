import crypto from "crypto";
import cf from "cloudfront";

/**
@typedef {{ value: string }} Value;
@typedef {{ uri: string; headers: Record<string, Value>; querystring: Record<string, Value & Partial<{ multiValue: Value[] }>> }} Request;
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
  // console.log("Received event: " + JSON.stringify(event, null, 2));
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
    /** @type {string[]} */
    const qsSorted = Object.keys(request.querystring)
      .reduce((all, k) => {
        if (request.querystring[k].multiValue) {
          all = all.concat(request.querystring[k].multiValue.map((mv) => `${k}=${mv.value}`));
        } else {
          all.push(`${k}=${request.querystring[k].value}`);
        }
        return all;
      }, [])
      .sort();

    let url = request.uri;
    const qsWithoutSignature = qsSorted.filter((s) => !s.startsWith("signature="));
    if (qsWithoutSignature.length) {
      url += `?${qsWithoutSignature.join("&")}`;
    }

    const hash = crypto.createHmac("sha256", secretKey).update(url).digest("hex");
    if (hash !== request.querystring.signature.value) {
      return {
        statusCode: 403,
        body: { data: "Invalid signature", encoding: "text" },
      };
    }

    // if valid then check for any expire qs
    if (request.querystring.expires) {
      const expiresInSec = Number(request.querystring.expires.value);
      const date = expiresInSec * 1000;
      const now = Date.now();
      if (date < now) {
        return {
          statusCode: 400,
          body: {
            encoding: "text",
            data: "Signature has expired, please request a new signature",
          },
        };
      }
    }

    // create a copy of host value since cloudfront will override host header to be from cloudfront
    if (request.headers.host) {
      request.headers["viewer-host"] = { value: request.headers.host.value };
    }
    // sort qs to have better cache hit ratio
    request.querystring = qsSorted.join("&");

    return request;
  } catch (e) {
    // console.error(e); // console.error not available for CF functions
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
