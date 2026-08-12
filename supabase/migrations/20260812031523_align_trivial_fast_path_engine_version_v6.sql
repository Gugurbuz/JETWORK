do $$
declare
  v_signature regprocedure := 'public.claim_trivial_assistant_turn(text,text,text,text,integer,integer)'::regprocedure;
  v_definition text;
begin
  select pg_get_functiondef(v_signature) into v_definition;
  if v_definition is null then
    raise exception 'claim_trivial_assistant_turn definition not found';
  end if;

  v_definition := replace(
    v_definition,
    '''trivial-fast-path-v4-deterministic-greetings''',
    '''trivial-fast-path-v6-universal-short-turn'''
  );
  v_definition := replace(
    v_definition,
    '''trivial-fast-path-v5-social-intent''',
    '''trivial-fast-path-v6-universal-short-turn'''
  );

  execute v_definition;
end $$;
