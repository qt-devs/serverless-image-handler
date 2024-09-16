import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";

const marshallOptions = {
  // Specify your client options as usual
  convertEmptyValues: false,
  removeUndefinedValues: true,
};

export const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient(), { marshallOptions });

export const isAccountActive = async (appId: string, key: string) => {
  try {
    if (!appId) {
      return false;
    }

    const getCmd = new GetCommand({
      TableName: `${process.env.TABLE_NAME_PREFIX}-Shop`,
      Key: {
        appId,
        sk: `Setting#${appId}`,
      },
    });

    const res = await documentClient.send(getCmd);
    if (!res.Item) {
      console.log("app setting not found", key);
      return false;
    }
    return res.Item.status === "active";
  } catch (error) {
    console.error("Error in isAccountActive:", error);
    return false; // Default to inactive if there's an error
  }
};
