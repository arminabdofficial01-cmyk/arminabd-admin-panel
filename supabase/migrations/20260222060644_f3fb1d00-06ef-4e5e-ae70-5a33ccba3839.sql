
-- Add foreign key from orders.user_id to profiles.id so PostgREST can resolve the join
ALTER TABLE public.orders 
ADD CONSTRAINT orders_user_id_profiles_fkey 
FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
