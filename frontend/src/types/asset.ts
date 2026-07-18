/** Metadata of an uploaded binary asset (underlay image), as returned by `POST /api/assets`. */
export interface Asset {
  id: string
  content_type: string
  size_bytes: number
  created_at: string
}
