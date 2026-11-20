import { IsString, Matches, MaxLength } from 'class-validator';

export class VerifyAdminMfaDto {
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;

  @IsString()
  @MaxLength(4096)
  challengeToken!: string;
}
