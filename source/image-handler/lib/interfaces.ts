// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import sharp from "sharp";

import { ImageFormatTypes, RequestTypes, StatusCodes } from "./enums";
import { Headers, ImageEdits } from "./types";

export interface ImageHandlerEventFromCF {
  rawPath: string;
  queryStringParameters: Record<string, string>;
  headers: Record<string, string>;
  requestContext: Record<string, any>;
}
export interface ImageHandlerEvent {
  path?: string;
  queryStringParameters?: {
    signature: string;
  };
  requestContext?: {
    elb?: unknown;
  };
  headers?: Headers;
}

export interface DefaultImageRequest {
  bucket?: string;
  key: string;
  edits?: ImageEdits;
  outputFormat?: ImageFormatTypes;
  effort?: number;
  headers?: Headers;
}

export interface BoundingBox {
  height: number;
  left: number;
  top: number;
  width: number;
}

export interface BoxSize {
  height: number;
  width: number;
}

export interface ImageRequestInfo {
  requestType: RequestTypes;
  bucket: string;
  // this is the last part of the key, after the appId
  key: string;
  // this is the full key, including the appId, always use this for s3 operations
  fullKey: string;
  appId: string;
  edits?: ImageEdits;
  originalImage: Buffer;
  headers?: Headers;
  contentType?: string;
  expires?: string;
  lastModified?: string;
  cacheControl?: string;
  outputFormat?: ImageFormatTypes;
  effort?: number;
}

export interface RekognitionCompatibleImage {
  imageBuffer: {
    data: Buffer;
    info: sharp.OutputInfo;
  };
  format: keyof sharp.FormatEnum;
}

export interface ImageHandlerExecutionResult {
  statusCode: StatusCodes;
  isBase64Encoded: boolean;
  headers: Headers;
  body: string;
}
