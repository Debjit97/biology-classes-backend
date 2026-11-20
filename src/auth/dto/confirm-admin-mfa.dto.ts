import { IsString, Matches } from 'class-validator';

export class ConfirmAdminMfaDto {
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}
