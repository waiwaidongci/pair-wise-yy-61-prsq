import { createApi } from '@reduxjs/toolkit/query/react';
import type { BaseQueryFn } from '@reduxjs/toolkit/query';
import {
  fetchPackage,
  simulateExternalChange,
  submitCard,
  HttpError,
  type WorkCard,
  type WorkPackage,
  type PublicServerCard
} from './mockServer';

export type { WorkCard, WorkPackage, PublicServerCard };

type QueryArg =
  | { type: 'package' }
  | { type: 'submit'; cardId: string; baseCardRevision: number; measurement: string; finding: string }
  | { type: 'externalChange'; cardId: string };

const mockBaseQuery: BaseQueryFn<QueryArg> = async (arg) => {
  try {
    if (arg.type === 'package') {
      return { data: await fetchPackage() };
    }
    if (arg.type === 'submit') {
      return { data: await submitCard(arg) };
    }
    return { data: await simulateExternalChange(arg.cardId) };
  } catch (error) {
    if (error instanceof HttpError) {
      return { error: { status: error.status, data: error.data } };
    }
    return { error: { status: 0, data: { message: '网络不可用，请检查现场连接。' } } };
  }
};

export type SubmitCardPayload = { cardId: string; baseCardRevision: number; measurement: string; finding: string };
export type SubmitCardResult = { accepted: true; revision: number; cardRevision: number };
export type SubmitCardError = {
  status: number;
  data: { message: string; revision: number; cardRevision: number; serverCard: PublicServerCard };
};
export type ExternalChangeResult = { revision: number; cardRevision: number; card: PublicServerCard };

export const maintenanceApi = createApi({
  reducerPath: 'maintenanceApi',
  baseQuery: mockBaseQuery,
  tagTypes: ['Package'],
  endpoints: (builder) => ({
    getWorkPackage: builder.query<WorkPackage, void>({
      query: () => ({ type: 'package' }),
      providesTags: ['Package']
    }),
    submitCard: builder.mutation<SubmitCardResult, SubmitCardPayload>({
      query: (payload) => ({ type: 'submit', ...payload })
    }),
    simulateExternalChange: builder.mutation<ExternalChangeResult, { cardId: string }>({
      query: (payload) => ({ type: 'externalChange', cardId: payload.cardId }),
      invalidatesTags: ['Package']
    })
  })
});

export const { useGetWorkPackageQuery, useSubmitCardMutation, useSimulateExternalChangeMutation } = maintenanceApi;
