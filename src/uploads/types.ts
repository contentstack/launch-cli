export interface SignedUploadFormField {
  formFieldKey?: string;
  formFieldValue?: string;
}

export interface SignedUploadHeader {
  key?: string;
  value?: string;
}

export interface SignedUploadUrl {
  uploadUrl: string;
  uploadUid: string;
  method?: string;
  expiresIn?: number;
  fields?: SignedUploadFormField[] | null;
  headers?: SignedUploadHeader[] | null;
}
