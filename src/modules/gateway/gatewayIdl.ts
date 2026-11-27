/**
 * Candid interface of the OpenSocial gateway canister (backend/gateway).
 * Keep in sync with backend/gateway/open_social_gateway.did.
 */
import { IDL } from '@icp-sdk/core/candid';

export const GATEWAY_CANISTER_ID = 'ey3tv-myaaa-aaaae-ahhcq-cai';

export const gatewayIdl: IDL.InterfaceFactory = ({ IDL }) => {
  const LinkPreview = IDL.Record({
    url: IDL.Text,
    title: IDL.Opt(IDL.Text),
    description: IDL.Opt(IDL.Text),
    site_name: IDL.Opt(IDL.Text),
    image_url: IDL.Opt(IDL.Text),
  });
  const PreviewImage = IDL.Record({ bytes: IDL.Vec(IDL.Nat8), content_type: IDL.Text });
  const NewsItem = IDL.Record({
    id: IDL.Text,
    title: IDL.Text,
    summary: IDL.Opt(IDL.Text),
    protocol: IDL.Opt(IDL.Text),
    source: IDL.Opt(IDL.Text),
    url: IDL.Text,
    published_at_ms: IDL.Nat64,
    thumb: IDL.Opt(IDL.Text),
  });
  const NewsFeed = IDL.Record({ items: IDL.Vec(NewsItem), fetched_at_ns: IDL.Nat64 });
  const NewsArticle = IDL.Record({ id: IDL.Text, content_html: IDL.Text, cover_url: IDL.Opt(IDL.Text) });
  return IDL.Service({
    link_preview: IDL.Func([IDL.Text], [IDL.Variant({ Ok: LinkPreview, Err: IDL.Text })], []),
    link_preview_image: IDL.Func([IDL.Text], [IDL.Variant({ Ok: PreviewImage, Err: IDL.Text })], []),
    news: IDL.Func([], [NewsFeed], ['query']),
    refresh_news: IDL.Func([], [IDL.Variant({ Ok: NewsFeed, Err: IDL.Text })], []),
    cached_hashfirst: IDL.Func([IDL.Text], [IDL.Opt(IDL.Text)], ['query']),
    hashfirst: IDL.Func([IDL.Text], [IDL.Variant({ Ok: IDL.Text, Err: IDL.Text })], []),
    cached_news_article: IDL.Func([IDL.Text], [IDL.Opt(NewsArticle)], ['query']),
    news_article: IDL.Func([IDL.Text], [IDL.Variant({ Ok: NewsArticle, Err: IDL.Text })], []),
    cached_news_cover: IDL.Func([IDL.Text], [IDL.Opt(PreviewImage)], ['query']),
    news_cover: IDL.Func([IDL.Text], [IDL.Variant({ Ok: PreviewImage, Err: IDL.Text })], []),
  });
};
