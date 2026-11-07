import { db } from "@/server/db";
import { get_session } from "@/server/auth/session";
import { get_server_env } from "@/server/env";
import { create_media } from "@/server/media/create-media";
import { images_inspector, r2_media_bucket } from "@/server/media/r2";
import { parse_upload_request } from "@/server/media/upload-request";
import { media_url } from "@/lib/media-url";

export const dynamic = "force-dynamic";

const failure = (status: number, message: string) =>
  Response.json({ success: 0, message }, { status });

/**
 * `PUT /api/media?filename=&type=&sha256=[&thumbhash=]` with the raw file as the
 * body. Answers in the envelope EditorJS's image and attaches tools expect.
 */
export async function PUT(request: Request) {
  if (!(await get_session())) return failure(401, "Za nalaganje se morate prijaviti.");

  const parsed = parse_upload_request({
    content_length: request.headers.get("content-length"),
    query: new URL(request.url).searchParams,
  });
  if (!parsed.ok) return failure(parsed.rejection.status, parsed.rejection.message);
  if (!request.body) return failure(400, "Manjka vsebina datoteke.");

  const env = get_server_env();
  const media = create_media({
    db,
    bucket: r2_media_bucket(env.MEDIA),
    images: images_inspector(env.IMAGES),
  });
  const result = await media.ingest(request.body, parsed.upload);
  if (!result.ok) return failure(400, result.message);

  const { id, ext, filename, size_bytes, width, height, thumbhash } = result.media;
  return Response.json({
    success: 1,
    file: {
      url: media_url({ id, ext }),
      name: filename,
      extension: ext,
      size: size_bytes,
      width,
      height,
      thumbhash,
    },
  });
}
