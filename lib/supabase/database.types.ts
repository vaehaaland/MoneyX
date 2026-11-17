export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      loan_invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          loan_id: string
          role: string
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          loan_id: string
          role?: string
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          loan_id?: string
          role?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "loan_invites_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "loans"
            referencedColumns: ["id"]
          },
        ]
      }
      loan_members: {
        Row: {
          created_at: string
          loan_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          loan_id: string
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          loan_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loan_members_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "loans"
            referencedColumns: ["id"]
          },
        ]
      }
      loan_rates: {
        Row: {
          annual_rate_bp: number
          created_at: string
          id: string
          loan_id: string
          valid_from: string
        }
        Insert: {
          annual_rate_bp: number
          created_at?: string
          id?: string
          loan_id: string
          valid_from: string
        }
        Update: {
          annual_rate_bp?: number
          created_at?: string
          id?: string
          loan_id?: string
          valid_from?: string
        }
        Relationships: [
          {
            foreignKeyName: "loan_rates_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "loans"
            referencedColumns: ["id"]
          },
        ]
      }
      loan_recurring_payments: {
        Row: {
          amount_ore: number
          created_at: string
          created_by: string | null
          day_of_month: number
          end_date: string | null
          id: string
          kind: string
          loan_id: string
          next_due: string
          note: string | null
          start_date: string
        }
        Insert: {
          amount_ore: number
          created_at?: string
          created_by?: string | null
          day_of_month: number
          end_date?: string | null
          id?: string
          kind?: string
          loan_id: string
          next_due: string
          note?: string | null
          start_date: string
        }
        Update: {
          amount_ore?: number
          created_at?: string
          created_by?: string | null
          day_of_month?: number
          end_date?: string | null
          id?: string
          kind?: string
          loan_id?: string
          next_due?: string
          note?: string | null
          start_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "loan_recurring_payments_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "loans"
            referencedColumns: ["id"]
          },
        ]
      }
      loan_transactions: {
        Row: {
          amount_ore: number
          created_at: string
          created_by: string | null
          date: string
          id: string
          kind: string
          loan_id: string
          note: string | null
          recurring_id: string | null
        }
        Insert: {
          amount_ore: number
          created_at?: string
          created_by?: string | null
          date: string
          id?: string
          kind: string
          loan_id: string
          note?: string | null
          recurring_id?: string | null
        }
        Update: {
          amount_ore?: number
          created_at?: string
          created_by?: string | null
          date?: string
          id?: string
          kind?: string
          loan_id?: string
          note?: string | null
          recurring_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loan_transactions_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "loans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loan_transactions_recurring_id_fkey"
            columns: ["recurring_id"]
            isOneToOne: false
            referencedRelation: "loan_recurring_payments"
            referencedColumns: ["id"]
          },
        ]
      }
      loan_views: {
        Row: {
          last_seen_at: string
          loan_id: string
          user_id: string
        }
        Insert: {
          last_seen_at?: string
          loan_id: string
          user_id?: string
        }
        Update: {
          last_seen_at?: string
          loan_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loan_views_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "loans"
            referencedColumns: ["id"]
          },
        ]
      }
      loans: {
        Row: {
          archived_at: string | null
          capitalization: string
          counterparty_name: string | null
          created_at: string
          currency: string
          direction: string
          id: string
          name: string
          owner_id: string
          start_date: string
        }
        Insert: {
          archived_at?: string | null
          capitalization?: string
          counterparty_name?: string | null
          created_at?: string
          currency?: string
          direction: string
          id?: string
          name: string
          owner_id?: string
          start_date: string
        }
        Update: {
          archived_at?: string | null
          capitalization?: string
          counterparty_name?: string | null
          created_at?: string
          currency?: string
          direction?: string
          id?: string
          name?: string
          owner_id?: string
          start_date?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_loan_invite: { Args: { p_token: string }; Returns: Json }
      loan_invite_preview: { Args: { p_token: string }; Returns: Json }
      loan_people: {
        Args: { p_loan_id?: string }
        Returns: {
          display_name: string
          email: string
          joined_at: string
          loan_id: string
          role: string
          user_id: string
        }[]
      }
      mark_loan_seen: { Args: { p_loan_id: string }; Returns: undefined }
      post_due_recurring_payments: {
        Args: { p_loan_id?: string }
        Returns: number
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
