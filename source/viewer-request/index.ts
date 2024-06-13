import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { createHmac } from "crypto";

type Config = {
  distributionDomainName: string; // "d111111abcdef8.cloudfront.net",
  distributionId: string; // "EDFDVBD6EXAMPLE",
  eventType: "viewer-request" | "viewer-response" | "origin-request" | "origin-response";
  requestId: string; //"4TyzHTaYWb1GX1qTfsHhEqV6HUDd_BzoBZnwfnvQc_1oF26ClkoUSEQ=="
};
type LambdaEvent = {
  Records: Array<{
    cf: {
      request: { uri: string; querystring: string };
      config: Config;
    };
  }>;
};

const secretManagerClient = new SecretsManagerClient();
let secretCache: string | undefined;

const getSecret = async () => {
  if (!secretCache) {
    const response = await secretManagerClient.send(
      new GetSecretValueCommand({ SecretId: process.env.PHX_SMG_SIGNATURE_KEY })
    );
    secretCache = response.SecretString;
  }
  return secretCache;
};

export async function handler(event: LambdaEvent) {
  console.info("Received event:", JSON.stringify(event, null, 2));
  const { request, config } = event.Records[0].cf; // CloudFront request object

  if (/favicon\.ico$/gi.test(request.uri)) {
    return {
      status: "404",
    };
  }
  try {
    const queryStringParameters = request.querystring.split("&").reduce((qs, keyValue) => {
      const split = keyValue.split("=");
      qs[split[0]] = split[1];
      return qs;
    }, {} as NodeJS.Dict<string>);

    if (!queryStringParameters?.signature) {
      return {
        status: "401", // unauthorized
        body: "Missing signature",
      };
    }

    // const encoded = request.uri.startsWith("/") ? request.uri.slice(1) : request.uri;
    // const toBuffer = Buffer.from(encoded, "base64");

    // // To support European characters, 'ascii' was removed.
    // const decoded = JSON.parse(toBuffer.toString());

    // verify signature matches so we know it's generated from us
    const secretKey = await getSecret();
    const hash = createHmac("sha256", secretKey).update(request.uri).digest("hex");

    if (hash !== queryStringParameters.signature) {
      return {
        status: "403",
        body: "Invalid signature",
      };
    }

    return request;
  } catch (e: any) {
    // do nothing and continue to next origin request to process
    console.error(e);
    return {
      status: "400",
      body:
        process.env.NODE_ENV === "develop"
          ? e.message
          : `An error occured, please contact us to resolve this issue. Reference #${config.requestId}`,
    };
  }
}
