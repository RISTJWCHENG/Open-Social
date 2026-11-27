// Generated from src/modules/icp-identity/identityIdl.ts for Node scripts.
/**
 * Candid interface of the OpenSocial identity canister (backend/identity).
 * Keep in sync with backend/identity/open_social_identity.did.
 */
export const identityIdl = ({ IDL }) => {
  const SessionRequest = IDL.Record({
    session_key: IDL.Vec(IDL.Nat8),
    max_time_to_live_ns: IDL.Opt(IDL.Nat64),
  });
  const Prepared = IDL.Record({
    user_key: IDL.Vec(IDL.Nat8),
    expiration_ns: IDL.Nat64,
    account_principal: IDL.Principal,
    new_account: IDL.Bool,
  });
  const ResPrepared = IDL.Variant({ Ok: Prepared, Err: IDL.Text });
  const SignedDelegation = IDL.Record({
    pubkey: IDL.Vec(IDL.Nat8),
    expiration_ns: IDL.Nat64,
    signature: IDL.Vec(IDL.Nat8),
  });
  const PasskeyChallenge = IDL.Record({
    challenge_id: IDL.Text,
    challenge: IDL.Vec(IDL.Nat8),
    rp_id: IDL.Text,
  });
  const PasskeyRegistration = IDL.Record({
    challenge_id: IDL.Text,
    origin: IDL.Text,
    credential_id: IDL.Vec(IDL.Nat8),
    attestation_object: IDL.Vec(IDL.Nat8),
    client_data_json: IDL.Vec(IDL.Nat8),
  });
  const PasskeyAssertion = IDL.Record({
    challenge_id: IDL.Text,
    origin: IDL.Text,
    credential_id: IDL.Vec(IDL.Nat8),
    authenticator_data: IDL.Vec(IDL.Nat8),
    client_data_json: IDL.Vec(IDL.Nat8),
    signature: IDL.Vec(IDL.Nat8),
  });
  const Link = IDL.Record({
    kind: IDL.Text,
    id: IDL.Text,
    label: IDL.Text,
    added_at_ns: IDL.Nat64,
  });
  const EmailChallenge = IDL.Record({
    challenge_id: IDL.Text,
    sent_to: IDL.Text,
    expires_at_ns: IDL.Nat64,
  });
  const EmailSenderInput = IDL.Record({
    api_key: IDL.Text,
    from: IDL.Text,
    daily_limit: IDL.Opt(IDL.Nat32),
  });
  const EmailStatus = IDL.Record({
    configured: IDL.Bool,
    from: IDL.Opt(IDL.Text),
    sent_today: IDL.Nat32,
    daily_limit: IDL.Nat32,
  });
  const Unit = IDL.Variant({ Ok: IDL.Null, Err: IDL.Text });
  const DeviceInput = IDL.Record({
    device_id: IDL.Text,
    encryption_key: IDL.Vec(IDL.Nat8),
    signing_key: IDL.Vec(IDL.Nat8),
    label: IDL.Text,
  });
  const PublicDevice = IDL.Record({
    device_id: IDL.Text,
    encryption_key: IDL.Vec(IDL.Nat8),
    signing_key: IDL.Vec(IDL.Nat8),
    label: IDL.Text,
    added_at_ns: IDL.Nat64,
  });
  const Mail = IDL.Record({
    id: IDL.Nat64,
    from: IDL.Principal,
    received_at_ns: IDL.Nat64,
    entry: IDL.Vec(IDL.Nat8),
  });
  return IDL.Service({
    register_device: IDL.Func([DeviceInput], [Unit], []),
    publish_key_packages: IDL.Func(
      [IDL.Text, IDL.Opt(IDL.Vec(IDL.Nat8)), IDL.Vec(IDL.Vec(IDL.Nat8))],
      [IDL.Variant({ Ok: IDL.Nat32, Err: IDL.Text })],
      [],
    ),
    claim_key_package: IDL.Func(
      [IDL.Principal, IDL.Text],
      [
        IDL.Variant({
          Ok: IDL.Opt(IDL.Record({ last_resort: IDL.Vec(IDL.Nat8), single_use: IDL.Opt(IDL.Vec(IDL.Nat8)) })),
          Err: IDL.Text,
        }),
      ],
      [],
    ),
    delete_account: IDL.Func([], [Unit], []),
    remove_device: IDL.Func([IDL.Text], [Unit], []),
    get_devices: IDL.Func([IDL.Principal], [IDL.Vec(PublicDevice)], ['query']),
    deposit: IDL.Func(
      [IDL.Principal, IDL.Text, IDL.Vec(IDL.Nat8)],
      [IDL.Variant({ Ok: IDL.Nat64, Err: IDL.Text })],
      [],
    ),
    deposit_batch: IDL.Func(
      [
        IDL.Vec(
          IDL.Record({
            to: IDL.Principal,
            device_id: IDL.Text,
            entry: IDL.Vec(IDL.Nat8),
            ephemeral: IDL.Bool,
          }),
        ),
      ],
      [IDL.Variant({ Ok: IDL.Record({ ids: IDL.Vec(IDL.Nat64), skipped: IDL.Vec(IDL.Nat32) }), Err: IDL.Text })],
      [],
    ),
    fetch_mail: IDL.Func(
      [IDL.Text, IDL.Nat64],
      [IDL.Variant({ Ok: IDL.Vec(Mail), Err: IDL.Text })],
      ['query'],
    ),
    ack_mail: IDL.Func([IDL.Text, IDL.Nat64], [IDL.Variant({ Ok: IDL.Nat32, Err: IDL.Text })], []),
    email_challenge: IDL.Func(
      [IDL.Text, IDL.Text],
      [IDL.Variant({ Ok: EmailChallenge, Err: IDL.Text })],
      [],
    ),
    email_sign_in: IDL.Func([IDL.Text, IDL.Text, SessionRequest], [ResPrepared], []),
    email_sender_status: IDL.Func([], [EmailStatus], ['query']),
    set_email_sender: IDL.Func([IDL.Opt(EmailSenderInput)], [Unit], []),
    am_i_admin: IDL.Func([], [IDL.Bool], ['query']),
    get_delegation: IDL.Func(
      [IDL.Principal, IDL.Vec(IDL.Nat8), IDL.Nat64],
      [IDL.Variant({ Ok: SignedDelegation, Err: IDL.Text })],
      ['query'],
    ),
    sign_in_with_ii: IDL.Func([SessionRequest], [ResPrepared], []),
    passkey_challenge: IDL.Func(
      [IDL.Text],
      [IDL.Variant({ Ok: PasskeyChallenge, Err: IDL.Text })],
      [],
    ),
    passkey_register: IDL.Func([PasskeyRegistration, SessionRequest], [ResPrepared], []),
    passkey_sign_in: IDL.Func([PasskeyAssertion, SessionRequest], [ResPrepared], []),
    my_sign_in_methods: IDL.Func([], [IDL.Variant({ Ok: IDL.Vec(Link), Err: IDL.Text })], ['query']),
    link_email: IDL.Func([IDL.Text, IDL.Text], [IDL.Variant({ Ok: Link, Err: IDL.Text })], []),
  });
};
